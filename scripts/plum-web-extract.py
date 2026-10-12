"""Bounded public HTML → reference text. Never executes page scripts."""
import json
import sys
from html.parser import HTMLParser

class Document(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = []
        self.parts = []
        self.size = 0
        self.title = []
        self.in_title = False
        self.truncated = False

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in {"script", "style", "template", "noscript", "svg", "nav", "footer"}:
            self.hidden.append(tag)
        if tag in {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "tr", "section", "article"} and not self.hidden:
            self.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if self.hidden and tag in self.hidden:
            self.hidden = self.hidden[:self.hidden.index(tag)]
        if tag in {"p", "div", "li", "h1", "h2", "h3", "h4", "tr", "section", "article"} and not self.hidden:
            self.append("\n")

    def handle_data(self, data):
        if self.in_title:
            if sum(map(len, self.title)) < 200:
                self.title.append(data[:200])
        elif not self.hidden:
            self.append(" ".join(data.split()) + " ")

    def append(self, text):
        remaining = 60000 - self.size
        self.truncated |= len(text) > remaining
        self.parts.append(text[:max(0, remaining)])
        self.size += min(len(text), max(0, remaining))

raw = sys.stdin.buffer.read(1024 * 1024 + 1)
if len(raw) > 1024 * 1024:
    raise ValueError("HTML too large")
parser = Document()
parser.feed(raw.decode("utf-8-sig", errors="strict"))
parser.close()
text = "\n".join(line.strip() for line in "".join(parser.parts).splitlines() if line.strip())
print(json.dumps({"title": " ".join("".join(parser.title).split())[:200], "text": text[:50000], "truncated": parser.truncated or len(text) > 50000}, ensure_ascii=False))
