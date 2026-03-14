/**
 * Shared .docx parsing used by upload route and seed script.
 */

export function parseDocxSections(htmlContent: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = [];

  const parts = htmlContent.split(/(?=<h[1-6])/i);

  for (const part of parts) {
    const headingMatch = part.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i);
    const heading = headingMatch ? headingMatch[1].replace(/<[^>]*>/g, "").trim() : "";
    const content = part
      .replace(/<h[1-6][^>]*>.*?<\/h[1-6]>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (heading || content) {
      sections.push({ heading, content });
    }
  }

  if (sections.length === 0 && htmlContent.trim()) {
    const plainText = htmlContent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (plainText) sections.push({ heading: "Document Content", content: plainText });
  }

  const textLines = htmlContent.replace(/<[^>]*>/g, "\n").split("\n").filter(l => l.trim());
  const debateSections: Array<{ heading: string; content: string }> = [];
  let currentHeading = "";
  let currentContent: string[] = [];

  for (const line of textLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeadingLike =
      (trimmed.length < 80 && /^[A-Z!]/.test(trimmed) && !trimmed.endsWith(".")) ||
      trimmed.includes("---") ||
      trimmed.startsWith("1AR") || trimmed.startsWith("1NC") || trimmed.startsWith("2AR") || trimmed.startsWith("2NC") ||
      /^(Impact|Link|Internal Link|Uniqueness|Turn|Shell|Frontline|Extension|AT:|A2:|Contention)/i.test(trimmed);

    if (isHeadingLike && currentContent.length > 0) {
      debateSections.push({
        heading: currentHeading,
        content: currentContent.join(" ").trim(),
      });
      currentHeading = trimmed;
      currentContent = [];
    } else if (isHeadingLike && currentContent.length === 0) {
      currentHeading = currentHeading ? `${currentHeading} - ${trimmed}` : trimmed;
    } else {
      currentContent.push(trimmed);
    }
  }

  if (currentContent.length > 0) {
    debateSections.push({
      heading: currentHeading,
      content: currentContent.join(" ").trim(),
    });
  }

  const allSections = [...sections];
  for (const ds of debateSections) {
    const isDuplicate = allSections.some(
      (s) => s.heading === ds.heading || (ds.content.length > 50 && s.content.includes(ds.content.slice(0, 50)))
    );
    if (!isDuplicate && ds.content.length > 20) {
      allSections.push(ds);
    }
  }

  return allSections;
}

export interface ParsedCard {
  tag: string;
  cite: string;
  body: string;
  isAnalytic: boolean;
  sectionHeading: string | null;
}

export function parseEvidenceCards(htmlContent: string): ParsedCard[] {
  const cards: ParsedCard[] = [];

  const paragraphs: Array<{ text: string; isBold: boolean; isUnderline: boolean; isHighlight: boolean; headingLevel: number; html: string }> = [];

  const blockPattern = /<(p|h[1-6])[^>]*>([\s\S]*?)<\/(?:p|h[1-6])>/gi;
  let match;
  while ((match = blockPattern.exec(htmlContent)) !== null) {
    const tagName = match[1].toLowerCase();
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const isBold = /<strong|<b[\s>]|font-weight:\s*bold/i.test(innerHtml);
    const isUnderline = /<u[\s>]|text-decoration[^"]*underline/i.test(innerHtml);
    const isHighlight = /background-color|<mark/i.test(innerHtml);
    const headingMatch = tagName.match(/^h(\d)$/);
    const headingLevel = headingMatch ? parseInt(headingMatch[1]) : 0;

    paragraphs.push({
      text,
      isBold: isBold || headingLevel > 0,
      isUnderline,
      isHighlight,
      headingLevel,
      html: innerHtml,
    });
  }

  if (paragraphs.length === 0) return [];

  const citePattern = /^[\[\(]?\s*[A-Z][a-zA-Z'\-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z'\-]+))?\s*(?:,?\s*(?:'?\d{2,4}|20[0-2]\d|19\d{2}))/;
  const citePattern2 = /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/;
  const citePattern3 = /(?:PhD|Professor|Dr\.|University|Institute|Journal|Fellow|Director)/i;
  const yearBracketPattern = /[\[\(]\s*[A-Z].*?\d{2,4}\s*[\]\)]/;

  function isCiteLine(text: string): boolean {
    if (text.length > 500) return false;
    return citePattern.test(text) || yearBracketPattern.test(text) ||
      (citePattern2.test(text) && text.length < 300) ||
      (citePattern3.test(text) && text.length < 300);
  }

  function isSectionDivider(idx: number): boolean {
    const p = paragraphs[idx];
    if (p.headingLevel === 1 || p.headingLevel === 2) return true;
    if (p.headingLevel === 3) {
      for (let k = idx + 1; k < Math.min(idx + 6, paragraphs.length); k++) {
        const next = paragraphs[k];
        if (next.text.length === 0) continue;
        if (next.headingLevel === 1 || next.headingLevel === 2) return true;
        if (isCiteLine(next.text)) return false;
        if (next.headingLevel >= 3) return true;
        break;
      }
      return true;
    }
    return false;
  }

  function isTagLine(text: string, p: typeof paragraphs[0]): boolean {
    if (text.length < 3) return false;
    if (p.headingLevel >= 3) return true;
    if (text.length > 300) return false;
    if (p.isBold || p.isUnderline) return true;
    if (/^(AT[:.]?\s|A2[:.]?\s|Answer to|Answers|Impact|Link|Turn|Internal Link|Uniqueness|Nonunique|No Link|Link Turn|No Impact|Impact Turn|Contention|Shell|Frontline|Extension|1AR|1NC|2AR|2NC)/i.test(text)) return true;
    if (/^[A-Z][^.]*$/.test(text) && text.length < 100) return true;
    return false;
  }

  let currentSectionHeading: string | null = null;
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];

    if (isSectionDivider(i)) {
      currentSectionHeading = p.text;
      i++;
      continue;
    }

    if (isTagLine(p.text, p)) {
      const tag = p.text;
      let cite = "";
      let bodyParts: string[] = [];
      let j = i + 1;

      if (j < paragraphs.length && isCiteLine(paragraphs[j].text)) {
        cite = paragraphs[j].text;
        j++;
      }

      while (j < paragraphs.length) {
        const next = paragraphs[j];
        if (isSectionDivider(j)) break;
        if (isTagLine(next.text, next) && !isCiteLine(next.text)) break;
        if (isCiteLine(next.text) && bodyParts.length > 0) break;
        bodyParts.push(next.text);
        j++;
      }

      const body = bodyParts.join("\n\n");

      if (cite || body.length > 50) {
        cards.push({ tag, cite, body, isAnalytic: false, sectionHeading: currentSectionHeading });
      } else if (body.length === 0 || body.length <= 50) {
        cards.push({ tag, cite: "", body, isAnalytic: true, sectionHeading: currentSectionHeading });
      }

      i = j;
    } else {
      i++;
    }
  }

  return cards;
}
