import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('office_import', root / 'scripts/plum-office-extract.py')
office = importlib.util.module_from_spec(spec)
spec.loader.exec_module(office)


def archive(entries):
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as file:
        for name, content in entries.items():
            file.writestr(name, content)
    data.seek(0)
    return data


class OfficeImportTest(unittest.TestCase):
    def extract(self, entries):
        return office.extract(archive(entries))

    def test_word_current_view_and_original_changes(self):
        result = self.extract({'word/document.xml': '<w:document xmlns:w="'+office.NS['w']+'"><w:body><w:p><w:r><w:t>Äpfel </w:t></w:r><w:ins><w:r><w:t>neu</w:t></w:r></w:ins><w:del><w:r><w:delText>gelöscht</w:delText></w:r></w:del></w:p></w:body></w:document>'})
        self.assertEqual(result['text'], 'Äpfel neu')
        self.assertTrue(any('Änderungsmarkierungen' in item for item in result['warnings']))

    def test_sheet_coordinates_formula_cache_and_literal(self):
        result = self.extract({
            'xl/workbook.xml': '<s:workbook xmlns:s="'+office.NS['s']+'" xmlns:r="'+office.NS['r']+'"><s:sheets><s:sheet name="Daten" r:id="r1"/></s:sheets></s:workbook>',
            'xl/_rels/workbook.xml.rels': '<Relationships xmlns="'+office.REL+'"><Relationship Id="r1" Target="worksheets/sheet9.xml"/></Relationships>',
            'xl/worksheets/sheet9.xml': '<worksheet xmlns="'+office.NS['s']+'"><sheetData><row r="1"><c r="A1"><v>2</v></c><c r="B1"><f>SUM(A1,3)</f><v>5</v></c><c r="C1" t="inlineStr"><is><t>=WEBSERVICE("https://example.invalid")</t></is></c></row></sheetData></worksheet>'})
        sheet = result['sheets'][0]
        self.assertEqual(sheet['grid'][0][:2], ['2', '=SUM(A1,3)'])
        self.assertTrue(sheet['grid'][0][2].startswith("'=WEBSERVICE"))
        self.assertEqual(sheet['cells'][1]['cached'], '5')
        self.assertIn('B1: =SUM(A1,3) [gespeichert: 5]', result['text'])

    def test_slide_order_follows_presentation_relationships(self):
        result = self.extract({
            'ppt/presentation.xml': '<p:presentation xmlns:p="'+office.NS['p']+'" xmlns:r="'+office.NS['r']+'"><p:sldIdLst><p:sldId r:id="second"/><p:sldId r:id="first"/></p:sldIdLst></p:presentation>',
            'ppt/_rels/presentation.xml.rels': '<Relationships xmlns="'+office.REL+'"><Relationship Id="first" Target="slides/slide1.xml"/><Relationship Id="second" Target="slides/slide2.xml"/></Relationships>',
            **{f'ppt/slides/slide{i}.xml': '<p:sld xmlns:p="'+office.NS['p']+'" xmlns:a="'+office.NS['a']+'"><a:t>'+text+'</a:t></p:sld>' for i, text in [(1, 'Zweite'), (2, 'Erste')]}})
        self.assertEqual([item['text'] for item in result['slides']], ['Erste', 'Zweite'])

    def test_entity_traversal_and_zip_bomb_are_rejected(self):
        for entries in [
            {'word/document.xml': '<!DOCTYPE w [<!ENTITY secret SYSTEM "file:///etc/passwd">]><w/>'},
            {'../word/document.xml': '<w/>'},
            {'word/document.xml': 'x' * (33 * 1024 * 1024)}]:
            with self.assertRaises(ValueError):
                self.extract(entries)


if __name__ == '__main__':
    unittest.main()
