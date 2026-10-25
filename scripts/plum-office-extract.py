"""Bounded OOXML text import. Keeps formulas as data; never runs Office or macros."""
import json
import base64
import io
import posixpath
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
    's': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
}
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
MAX_TEXT = 500000
warnings = ['Textimport: Layout, Bilder, Animationen und Formatvorlagen bleiben nur im Original erhalten.']
truncated = False
include_images = False
media = []


def xml(archive, name):
    data = archive.read(name)
    if len(data) > 8 * 1024 * 1024 or b'<!DOCTYPE' in data.upper() or b'<!ENTITY' in data.upper():
        raise ValueError('XML exceeds import limits or declares entities')
    return ET.fromstring(data)


def relationships(archive, base):
    folder, filename = posixpath.split(base)
    relfile = posixpath.join(folder, '_rels', filename + '.rels')
    if relfile not in archive.namelist():
        return {}
    result = {}
    for rel in xml(archive, relfile).findall(f'{{{REL}}}Relationship'):
        if rel.get('TargetMode') == 'External':
            continue
        name = posixpath.normpath(posixpath.join(folder, rel.get('Target', '').lstrip('/'))) if not rel.get('Target', '').startswith('/') else rel.get('Target')[1:]
        if name.startswith('../') or name not in archive.namelist():
            continue
        result[rel.get('Id')] = name
    return result


def word_text(element):
    # Current view: inserted text included, deleted revisions omitted. Original stays untouched.
    local = element.tag.rsplit('}', 1)[-1]
    if local in ('del', 'moveFrom'):
        return ''
    if local == 't':
        return element.text or ''
    if local == 'tab':
        return '\t'
    if local in ('br', 'cr'):
        return '\n'
    return ''.join(word_text(child) for child in element)


def paragraphs(root, prefix):
    return [''.join(p.itertext()) if prefix == 'plain' else word_text(p) for p in root.findall('.//w:p', NS)]


def word_model(archive, root):
    external = {}
    relfile = 'word/_rels/document.xml.rels'
    if relfile in archive.namelist():
        for rel in xml(archive, relfile).findall(f'{{{REL}}}Relationship'):
            target = rel.get('Target', '')
            if rel.get('TargetMode') == 'External' and target.startswith(('https://', 'http://')):
                external[rel.get('Id')] = target
    numbering = {}
    if 'word/numbering.xml' in archive.namelist():
        numbers = xml(archive, 'word/numbering.xml')
        abstracts = {a.get(f'{{{NS["w"]}}}abstractNumId'): a for a in numbers.findall('w:abstractNum', NS)}
        for num in numbers.findall('w:num', NS):
            definition = num.find('w:abstractNumId', NS)
            if definition is not None:
                numbering[num.get(f'{{{NS["w"]}}}numId')] = abstracts.get(definition.get(f'{{{NS["w"]}}}val'))
    def marked(element, name):
        node = element.find('w:rPr/w:' + name, NS)
        return node is not None and node.get(f'{{{NS["w"]}}}val', '1') not in ('0', 'false', 'off', 'none')
    def runs(node, href=None):
        local = node.tag.rsplit('}', 1)[-1]
        if local in ('del', 'moveFrom', 'pPr'): return []
        if local == 'hyperlink': href = external.get(node.get(f'{{{NS["r"]}}}id'))
        if local == 'r':
            value = word_text(node)
            if not value: return []
            item = {'text': value}
            for key, tag in [('bold', 'b'), ('italic', 'i'), ('underline', 'u')]:
                if marked(node, tag): item[key] = True
            if href: item['href'] = href
            return [item]
        return [item for child in node for item in runs(child, href)]
    def paragraph(node):
        block = {'type': 'paragraph', 'runs': runs(node) or [{'text': ''}]}
        style = node.find('w:pPr/w:pStyle', NS)
        heading = re.fullmatch(r'(?:Heading|Überschrift)([1-6])', style.get(f'{{{NS["w"]}}}val', ''), re.I) if style is not None else None
        if heading: block.update(type='heading', level=int(heading[1]))
        align = node.find('w:pPr/w:jc', NS)
        value = align.get(f'{{{NS["w"]}}}val') if align is not None else None
        if value in ('left', 'center', 'right', 'both'): block['align'] = 'justify' if value == 'both' else value
        number = node.find('w:pPr/w:numPr/w:numId', NS)
        if number is not None:
            block.update(type='list', ordered=True)
            abstract = numbering.get(number.get(f'{{{NS["w"]}}}val'))
            if abstract is not None:
                fmt = abstract.find('w:lvl/w:numFmt', NS)
                block['ordered'] = fmt is None or fmt.get(f'{{{NS["w"]}}}val') != 'bullet'
        return block
    image_rels = relationships(archive, 'word/document.xml')
    imported_images = {}
    total_image_bytes = 0
    def images(node):
        nonlocal total_image_bytes
        result = []
        def visit(part):
            nonlocal total_image_bytes
            local = part.tag.rsplit('}', 1)[-1]
            if local in ('del', 'moveFrom'): return
            if local == 'drawing':
                for blip in part.findall('.//a:blip', NS):
                    name = image_rels.get(blip.get(f'{{{NS["r"]}}}embed'))
                    if not name or not name.startswith('word/media/'):
                        warnings.append('Nicht eingebettetes Word-Bild bleibt nur im Original.')
                        continue
                    if name not in imported_images:
                        data = archive.read(name)
                        if len(imported_images) >= 4 or total_image_bytes + len(data) > 2 * 1024 * 1024:
                            warnings.append('Word-Bilder über vier Originale oder zusammen 2 MB bleiben nur im Original.')
                            continue
                        try:
                            from PIL import Image
                            image = Image.open(io.BytesIO(data))
                            if image.format not in ('PNG', 'JPEG') or image.width * image.height > 16000000: raise ValueError('Unsupported image')
                            mime = 'image/png' if image.format == 'PNG' else 'image/jpeg'
                            image.verify()
                        except (ValueError, OSError):
                            warnings.append('Nicht unterstütztes oder beschädigtes Word-Bild bleibt nur im Original.')
                            continue
                        total_image_bytes += len(data)
                        key = 'media-' + str(len(imported_images) + 1)
                        imported_images[name] = key
                        media.append({'id': key, 'filename': posixpath.basename(name), 'mimeType': mime, 'base64': base64.b64encode(data).decode('ascii')})
                    prop = part.find('.//wp:docPr', NS)
                    alt = (prop.get('descr') or prop.get('name') or 'Bild')[:500] if prop is not None else 'Bild'
                    result.append({'type': 'image', 'mediaId': imported_images[name], 'alt': alt, 'caption': ''})
                return
            for child in part: visit(child)
        if include_images: visit(node)
        return result
    blocks = []
    for node in root.find('w:body', NS):
        if node.tag == f'{{{NS["w"]}}}p':
            block = paragraph(node)
            pictures = images(node)
            style = node.find('w:pPr/w:pStyle', NS)
            if include_images and blocks and blocks[-1]['type'] == 'image' and style is not None and style.get(f'{{{NS["w"]}}}val') == 'Caption' and not pictures:
                blocks[-1]['caption'] = word_text(node)[:500]
                continue
            if not pictures or word_text(node): blocks.append(block)
            if pictures and word_text(node): warnings.append('Word-Bild innerhalb eines Textabsatzes wird nach diesem Absatz angeordnet; das Original erhält die genaue Position.')
            blocks.extend(pictures)
        elif node.tag == f'{{{NS["w"]}}}tbl':
            if include_images and node.find('.//a:blip', NS) is not None: warnings.append('Bilder in Word-Tabellen verbleiben im Original.')
            rows = []
            for row in node.findall('w:tr', NS):
                cells = []
                for cell in row.findall('w:tc', NS):
                    content = []
                    for index, p in enumerate(cell.findall('w:p', NS)):
                        if index: content.append({'text': '\n'})
                        content.extend(runs(p))
                    cells.append(content or [{'text': ''}])
                rows.append(cells)
            if rows:
                width = max(map(len, rows))
                blocks.append({'type': 'table', 'rows': [row + [[{'text': ''}]] * (width-len(row)) for row in rows]})
    return {'type': 'plum-document', 'version': 1, 'blocks': blocks or [{'type': 'paragraph', 'runs': [{'text': ''}]}]}


def docx(archive):
    root = xml(archive, 'word/document.xml')
    parts = paragraphs(root, 'word')
    if root.find('.//w:ins', NS) is not None or root.find('.//w:del', NS) is not None:
        warnings.append('Änderungsmarkierungen: Textansicht enthält eingefügten, nicht gelöschten Text; das Original enthält den vollständigen Änderungsverlauf.')
    for name in archive.namelist():
        if re.fullmatch(r'word/(header\d+|footer\d+|footnotes|endnotes)\.xml', name):
            parts.append(f'[{posixpath.basename(name)}]')
            parts.extend(paragraphs(xml(archive, name), 'word'))
    text = '\n'.join(parts)
    warnings.append('Word-Kopie erhält Absätze, direkte Fett-/Kursiv-/Unterstreichung, Überschriften, Listen, Ausrichtung, Weblinks und Tabellen. Feldfunktionen, Kopf-/Fusszeilen und benutzerdefinierte Layouts bleiben im Original.' if include_images else 'Word-Kopie erhält Absätze, direkte Fett-/Kursiv-/Unterstreichung, Überschriften, Listen, Ausrichtung, Weblinks und Tabellen. Eingebettete Bilder, Feldfunktionen, Kopf-/Fusszeilen und benutzerdefinierte Layouts bleiben im Original.')
    document = word_model(archive, root)
    if include_images: warnings.append('Word-Kopie übernimmt eigene eingebettete PNG-/JPEG-Originale bis vier Bilder/2 MB und Bildunterschriften; freies Layout und andere Medien verbleiben im Original.')
    return {'kind': 'docx', 'text': text[:MAX_TEXT], 'document': document, 'media': media, 'truncated': len(text) > MAX_TEXT}


def pptx(archive):
    presentation = 'ppt/presentation.xml'
    rels = relationships(archive, presentation)
    ids = xml(archive, presentation).findall('.//p:sldId', NS)
    slides = []
    native_slides = []
    native_complete = True
    count = 0
    for slide in ids[:200]:
        name = rels.get(slide.get(f'{{{NS["r"]}}}id'))
        if not name:
            warnings.append('Eine Folie konnte nicht aufgelöst werden.')
            continue
        root = xml(archive, name)
        lines = [''.join(node.itertext()) for node in root.findall('.//a:t', NS)]
        text = '\n'.join(lines)
        shapes = {}
        for shape in root.findall('p:cSld/p:spTree/p:sp', NS):
            identity = shape.find('p:nvSpPr/p:cNvPr', NS)
            if identity is not None:
                shapes[identity.get('name')] = ('\n'.join(''.join(t.text or '' for t in paragraph.findall('.//a:t', NS)) for paragraph in shape.findall('p:txBody/a:p', NS)), shape.find('.//a:buChar', NS) is not None)
        notes = []
        for target in relationships(archive, name).values():
            if target.startswith('ppt/notesSlides/'):
                notes.extend(node.text or '' for node in xml(archive, target).findall('.//a:t', NS))
        count += len(text) + sum(map(len, notes))
        if count > MAX_TEXT:
            break
        slides.append({'text': text, 'notes': '\n'.join(notes)})
        if 'Titel' in shapes and 'Inhalt' in shapes:
            native_slides.append({'title':shapes['Titel'][0], 'layout':'columns' if 'Zweite Spalte' in shapes else 'bullets' if shapes['Inhalt'][1] else 'title', 'text':shapes['Inhalt'][0], 'secondary':shapes.get('Zweite Spalte',shapes.get('Zusatz',('',False)))[0], 'notes':'\n'.join(notes)})
        else:
            native_complete = False
    return {'kind': 'pptx', 'slides': slides,
            'text': '\n\n'.join(f'[Folie {i+1}]\n{s["text"]}' + (f'\n[Notizen]\n{s["notes"]}' if s['notes'] else '') for i, s in enumerate(slides)),
            'truncated': count > MAX_TEXT or len(ids) > 200, 'slideCount': len(ids),
            'presentation': {'type':'plum-slides','version':1,'slides':native_slides} if native_complete and native_slides else None}


def xlsx(archive):
    workbook = 'xl/workbook.xml'
    rels = relationships(archive, workbook)
    shared = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared = [''.join(t.text or '' for t in item.findall('.//s:t', NS)) for item in xml(archive, 'xl/sharedStrings.xml').findall('s:si', NS)]
    sheets = []
    names = xml(archive, workbook).findall('.//s:sheet', NS)
    cells_left = 20000
    text_left = MAX_TEXT
    limited = False
    for sheet in names[:20]:
        name = rels.get(sheet.get(f'{{{NS["r"]}}}id'))
        if not name:
            warnings.append('Ein Tabellenblatt konnte nicht aufgelöst werden.')
            continue
        cells = []
        grid = []
        for cell in xml(archive, name).findall('.//s:sheetData/s:row/s:c', NS):
            reference = cell.get('r', '')
            match = re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]*)', reference)
            if not match:
                continue
            column = 0
            for letter in match[1]:
                column = column * 26 + ord(letter) - 64
            row = int(match[2])
            if row > 1000 or column > 100 or cells_left <= 0 or text_left <= 0:
                limited = True
                continue
            cell_type = cell.get('t', 'n')
            cached = cell.findtext('s:v', '', NS)
            value = cached
            if cell_type == 's':
                value = shared[int(cached)] if cached.isdecimal() and int(cached) < len(shared) else ''
            elif cell_type == 'inlineStr':
                value = ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
            elif cell_type == 'b':
                value = 'TRUE' if cached == '1' else 'FALSE'
            formula = cell.find('s:f', NS)
            raw = '=' + (formula.text or '') if formula is not None and formula.text else value
            if formula is not None and not formula.text:
                warnings.append(f'Geteilte/Array-Formel in {sheet.get("name", "")}/{reference}: gespeicherter Wert verwendet; vollständige Formelstruktur steht im Original.')
            raw = raw[:5000]
            text_left -= len(raw) + len(reference) + 10
            cells_left -= 1
            while len(grid) < row:
                grid.append([])
            while len(grid[row - 1]) < column:
                grid[row - 1].append('')
            # Literal strings starting with '=' are not silently converted to formulas.
            grid[row - 1][column - 1] = "'" + raw if formula is None and raw.startswith('=') else raw
            cells.append({'cell': reference, 'type': cell_type, 'raw': raw, 'cached': cached})
        sheets.append({'name': sheet.get('name', 'Tabelle'), 'cells': cells, 'grid': grid})
    warnings.append('Tabellenimport erhält Zellbezüge, Rohformeln und gespeicherte Werte. Diagramme, Pivot, Formatierung und externe Bezüge bleiben im Original; fremde Formeln werden nicht ausgeführt.')
    return {'kind': 'xlsx', 'sheets': sheets, 'sheetCount': len(names),
            'text': '\n\n'.join(f'[Tabelle {s["name"]}]\n' + '\n'.join(f'{c["cell"]}: {c["raw"]}' + (f' [gespeichert: {c["cached"]}]' if c['raw'].startswith('=') else '') for c in s['cells']) for s in sheets)[:MAX_TEXT],
            'truncated': limited or len(names) > 20 or text_left < 0}


def extract(filename):
    global warnings, media
    media = []
    warnings = ['Textimport: Layout, Animationen und Formatvorlagen bleiben nur im Original erhalten.' if include_images else 'Textimport: Layout, Bilder, Animationen und Formatvorlagen bleiben nur im Original erhalten.']
    with zipfile.ZipFile(filename) as archive:
        items = archive.infolist()
        if len(items) > 3000 or sum(i.file_size for i in items) > 32 * 1024 * 1024:
            raise ValueError('Office archive exceeds import limits')
        names = [i.filename for i in items]
        if len(set(names)) != len(names) or any(i.flag_bits & 1 for i in items):
            raise ValueError('Duplicate or encrypted Office entries')
        if any(i.filename.startswith('/') or '..' in i.filename.split('/') or '\\' in i.filename for i in items):
            raise ValueError('Invalid Office archive path')
        for main, reader in [('word/document.xml', docx), ('xl/workbook.xml', xlsx), ('ppt/presentation.xml', pptx)]:
            if main in names:
                result = reader(archive)
                result['warnings'] = list(dict.fromkeys(warnings))[:100]
                return result
        raise ValueError('Unsupported Office archive')


if __name__ == '__main__':
    try:
        include_images = '--images' in sys.argv[2:]
        print(json.dumps(extract(sys.argv[1]), ensure_ascii=False))
    except (ValueError, KeyError, RecursionError, ET.ParseError, zipfile.BadZipFile, OSError):
        print('Office file cannot be imported safely', file=sys.stderr)
        sys.exit(1)
