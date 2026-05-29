import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"

export function convertHtmlToMarkdown(html: string): string {
  // Use a DOM parser to create a document from the HTML string
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")

  // Use Readability to extract the main content
  const reader = new Readability(doc)
  const article = reader.parse()

  if (!article || !article.content) {
    // Fallback to basic Turndown if Readability fails
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
    })
    return turndown.turndown(html)
  }

  // Use Turndown to convert the extracted HTML content to Markdown
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  })

  // Add some common rules for better extraction
  turndown.addRule("removeScripts", {
    filter: ["script", "style", "noscript"],
    replacement: () => "",
  })

  const markdown = turndown.turndown(article.content)

  // Prepend title if available
  if (article.title) {
    return `# ${article.title}\n\n${markdown}`
  }

  return markdown
}
