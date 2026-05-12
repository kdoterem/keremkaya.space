#!/usr/bin/env python3
"""Compile all blog posts into a single PDF, sorted chronologically."""

import os
import re
from pathlib import Path
from fpdf import FPDF

POSTS_DIR = Path(__file__).parent / "content" / "posts"
OUTPUT_FILE = Path(__file__).parent / "believablebelief-posts.pdf"

ARIAL_DIR = Path("/System/Library/Fonts/Supplemental")
FONT_REGULAR = str(ARIAL_DIR / "Arial.ttf")
FONT_BOLD    = str(ARIAL_DIR / "Arial Bold.ttf")

def parse_frontmatter(text):
    if not text.startswith("---"):
        return {}, text
    end = text.find("---", 3)
    if end == -1:
        return {}, text
    fm_raw = text[3:end].strip()
    content = text[end + 3:].strip()

    meta = {}
    for line in fm_raw.splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        # handle tags: ["a", "b"]
        if val.startswith("["):
            tags = re.findall(r'"([^"]+)"|\'([^\']+)\'', val)
            val = [t[0] or t[1] for t in tags]
        meta[key] = val
    return meta, content

def strip_markdown(md):
    md = re.sub(r"#{1,6}\s+", "", md)
    md = re.sub(r"\*\*([\s\S]*?)\*\*", r"\1", md)
    md = re.sub(r"\*([\s\S]*?)\*", r"\1", md)
    md = re.sub(r"`{1,3}[\s\S]*?`{1,3}", "", md)
    md = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", md)
    md = re.sub(r"^>\s*", "", md, flags=re.MULTILINE)
    md = re.sub(r"^[-*+]\s+", "", md, flags=re.MULTILINE)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()

def load_posts():
    posts = []
    for path in POSTS_DIR.glob("*.mdx"):
        text = path.read_text(encoding="utf-8")
        meta, content = parse_frontmatter(text)
        date = meta.get("date", "0000-00-00")
        title = meta.get("title", path.stem)
        plain = strip_markdown(content)
        posts.append({"date": date, "title": title, "content": plain, "slug": path.stem})
    posts.sort(key=lambda p: p["date"])
    return posts

class PDF(FPDF):
    def header(self):
        pass

    def footer(self):
        self.set_y(-12)
        self.set_font("Arial", size=8)
        self.set_text_color(160, 160, 160)
        self.cell(0, 10, str(self.page_no()), align="C")
        self.set_text_color(0, 0, 0)

def main():
    posts = load_posts()
    print(f"Compiling {len(posts)} posts...")

    pdf = PDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.set_margins(25, 25, 25)
    PAGE_W = 160  # A4 210mm - 25mm*2 margins
    pdf.add_font("Arial", style="",  fname=FONT_REGULAR)
    pdf.add_font("Arial", style="B", fname=FONT_BOLD)

    # Title page
    pdf.add_page()
    pdf.set_font("Arial", style="B", size=28)
    pdf.set_y(80)
    pdf.cell(0, 12, "Believable Belief", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Arial", size=11)
    pdf.set_text_color(120, 120, 120)
    pdf.ln(4)
    pdf.cell(0, 8, f"All Posts — {len(posts)} entries", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 8, "keremkaya.space", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)

    for i, post in enumerate(posts):
        pdf.add_page()

        # Date
        pdf.set_font("Arial", size=8)
        pdf.set_text_color(150, 150, 150)
        pdf.cell(0, 6, post["date"], new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
        pdf.ln(2)

        # Title
        pdf.set_font("Arial", style="B", size=16)
        pdf.multi_cell(PAGE_W, 8, post["title"])
        pdf.ln(6)

        # Content
        pdf.set_font("Arial", size=10.5)
        content = post["content"]
        if content:
            paragraphs = content.split("\n\n")
            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue
                lines = para.split("\n")
                for line in lines:
                    line = line.strip()
                    if line:
                        pdf.multi_cell(PAGE_W, 6, line)
                    else:
                        pdf.ln(3)
                pdf.ln(4)

        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(posts)}...")

    pdf.output(str(OUTPUT_FILE))
    print(f"Done → {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
