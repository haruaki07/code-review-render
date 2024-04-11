const { ZipWriter, BlobWriter, TextReader } = require("@zip.js/zip.js");
const fs = require("fs");
const path = require("path");
const { join } = require("path");

/**
 * @typedef {Object} CodeReviewEntry
 * @property {string} sha
 * @property {string} filename
 * @property {string} url
 * @property {string} lines
 * @property {string} title
 * @property {string} comment
 * @property {number} priority
 * @property {string} category
 * @property {string} additional
 * @property {string} id
 * @property {number} private
 * @property {string} code
 */

async function main() {
  const cwd = process.cwd();
  const codeReviewFilePath = process.argv[2];

  /** @type {CodeReviewEntry[]} */
  const codeReviewJson = JSON.parse(
    await fs.promises.readFile(codeReviewFilePath, {
      encoding: "utf-8",
    })
  );

  /** @type {Record<string, CodeReviewEntry[]>} */
  const entryMap = codeReviewJson.reduce(
    (prev, entry) => ({
      ...prev,
      [entry.filename]: [...(prev[entry.filename] ?? []), entry],
    }),
    {}
  );

  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));

  for (const key in entryMap) {
    const code = await fs.promises.readFile(join(cwd, key), {
      encoding: "utf-8",
    });

    const html = await renderToHtml(code, entryMap[key]);

    await zipWriter.add(key, new TextReader(html));
  }

  const zipBlob = await zipWriter.close();
  const zipFileName = join(cwd, path.parse(codeReviewFilePath).name + ".zip");
  await fs.promises.writeFile(
    zipFileName,
    Buffer.from(await zipBlob.arrayBuffer())
  );
  console.log("generated file: " + zipFileName);
}

/**
 *
 * @param {string} code
 * @param {CodeReviewEntry[]} entries
 * @returns
 */
async function renderToHtml(code, entries) {
  const { getHighlighter } = await import("shiki");

  const lines = entries.map((e) => e.lines).join(",");

  const highlighter = await getHighlighter({
    themes: ["github-dark-dimmed"],
    langs: ["php"],
  });

  return highlighter.codeToHtml(code, {
    theme: "github-dark-dimmed",
    lang: "php",
    transformers: [
      {
        code(codeEl) {
          const parsedLines = parseLines(lines);
          const linesEl = codeEl.children.filter(
            (c) => c.type === "element" && c.tagName === "span"
          );

          for (const i in linesEl) {
            const node = linesEl[i];
            node.properties = { ...node.properties, "data-line": +i + 1 };
            for (const posIdx in parsedLines) {
              const pos = parsedLines[posIdx];
              // highlight line
              if (i >= pos.start.line && i <= pos.end.line) {
                this.addClassToHast(node, "commented");
              }

              // insert review comments
              if (+i === pos.end.line) {
                let index;
                if (i >= this.lines.length) {
                  index = codeEl.children.length;
                } else {
                  const lineEl = this.lines[i];
                  index = codeEl.children.indexOf(lineEl);
                }

                // If there is a newline after this line, remove it because we have the error element take place.
                const nodeAfter = codeEl.children[index + 1];
                if (
                  nodeAfter &&
                  nodeAfter.type === "text" &&
                  nodeAfter.value === "\n"
                ) {
                  codeEl.children.splice(index + 1, 1);
                }

                codeEl.children.splice(index + 1, 0, {
                  type: "element",
                  tagName: "div",
                  properties: {
                    class: "comment",
                  },
                  children: [
                    {
                      type: "element",
                      tagName: "span",
                      properties: {},
                      children: [
                        {
                          type: "text",
                          value: entries[posIdx].comment,
                        },
                      ],
                    },
                  ],
                });
              }
            }
          }

          return codeEl;
        },
      },
    ],
  });
}

/**
 * Parses '12:0-12:63,9:2-12:1', it returns zero indexed positions.
 * @param {string} lines
 */
function parseLines(lines) {
  return lines.split(",").map((l) => {
    const [startLine, startCol, endLine, endCol] = l.split(/[:\-]/).map(Number);

    return {
      start: {
        line: startLine - 1,
        character: startCol,
      },
      end: {
        line: endLine - 1,
        character: endCol,
      },
    };
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
