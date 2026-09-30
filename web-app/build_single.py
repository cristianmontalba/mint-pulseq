"""
Bundle the site into ONE self-contained HTML file.

Reads index.html, replaces every local <link rel="stylesheet"> and <script src>
with the file's contents inline, and embeds examples/spin_echo_example.seq so
the Inspector's "load the bundled example" button works from file:// too.

The KaTeX and Google Fonts tags point at CDNs and are left as they are: without
internet the maths falls back to raw LaTeX and the fonts to system ones, but
every tool still works.

Usage:  python build_single.py            -> dist/MRI_Sequence_Design.html
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "MRI_Sequence_Design.html"
EXAMPLE = ROOT / "examples" / "spin_echo_example.seq"


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def inline_css(match: re.Match) -> str:
    href = match.group(1)
    if href.startswith(("http://", "https://")):
        return match.group(0)
    return f"<style>\n/* {href} */\n{read(href)}\n</style>"


def inline_js(match: re.Match) -> str:
    src = match.group(1)
    if src.startswith(("http://", "https://")):
        return match.group(0)
    body = read(src).replace("</script", r"<\/script")  # never close our own tag early
    return f"<script>\n// {src}\n{body}\n</script>"


def example_shim() -> str:
    # The Inspector fetches the example by relative URL, which file:// forbids.
    # Answer that one request from memory instead; every other fetch is untouched.
    seq = json.dumps(EXAMPLE.read_text(encoding="utf-8"))
    return (
        "<script>\n// bundled examples/spin_echo_example.seq\n"
        "(function () {\n"
        f"    var BUNDLED = {{ 'examples/spin_echo_example.seq': {seq} }};\n"
        "    var realFetch = window.fetch ? window.fetch.bind(window) : null;\n"
        "    window.fetch = function (url, opts) {\n"
        "        var key = String(url);\n"
        "        if (Object.prototype.hasOwnProperty.call(BUNDLED, key)) {\n"
        "            return Promise.resolve(new Response(BUNDLED[key], {\n"
        "                status: 200, headers: { 'Content-Type': 'text/plain' }\n"
        "            }));\n"
        "        }\n"
        "        if (!realFetch) return Promise.reject(new Error('fetch unavailable'));\n"
        "        return realFetch(url, opts);\n"
        "    };\n"
        "})();\n</script>"
    )


def main() -> None:
    html = read("index.html")
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', inline_css, html)
    html = re.sub(r'<script src="([^"]+)"></script>', inline_js, html)
    # Shim goes before the first inlined module so it is in place when needed.
    html = html.replace("<!-- Data -->", example_shim() + "\n    <!-- Data -->", 1)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
