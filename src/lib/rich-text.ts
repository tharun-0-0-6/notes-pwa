const ALLOWED_TAGS = new Set([
  'B',
  'BLOCKQUOTE',
  'BR',
  'DIV',
  'EM',
  'FONT',
  'I',
  'LI',
  'OL',
  'P',
  'SPAN',
  'STRONG',
  'U',
  'UL',
])

const BLOCKED_TAGS = new Set(['IFRAME', 'OBJECT', 'SCRIPT', 'STYLE'])
const FONT_SIZE_MAP: Record<string, string> = {
  '1': '10px',
  '2': '13px',
  '3': '16px',
  '4': '18px',
  '5': '24px',
  '6': '32px',
  '7': '48px',
}

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function cleanStyle(value: string) {
  const declarations = value.split(';').flatMap((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator < 0) {
      return []
    }

    const property = declaration.slice(0, separator).trim().toLowerCase()
    const styleValue = declaration.slice(separator + 1).trim().toLowerCase()
    const validLength = /^(\d+(?:\.\d+)?)(px|rem|em)$/
    if (
      property === 'font-size' &&
      (validLength.test(styleValue) || ['small', 'medium', 'large', 'x-large'].includes(styleValue))
    ) {
      return [`font-size: ${styleValue}`]
    }
    if (property === 'font-weight' && /^(normal|bold|[1-9]00)$/.test(styleValue)) {
      return [`font-weight: ${styleValue}`]
    }
    if (property === 'font-style' && /^(normal|italic)$/.test(styleValue)) {
      return [`font-style: ${styleValue}`]
    }
    if (property === 'text-decoration' && /^(none|underline)$/.test(styleValue)) {
      return [`text-decoration: ${styleValue}`]
    }
    if (property === 'margin-left' && validLength.test(styleValue)) {
      return [`margin-left: ${styleValue}`]
    }
    if (
      property === 'text-align' &&
      /^(left|right|center|justify)$/.test(styleValue)
    ) {
      return [`text-align: ${styleValue}`]
    }
    return []
  })

  return declarations.join('; ')
}

function sanitizeNode(node: Node, output: Document) {
  if (node.nodeType === Node.TEXT_NODE) {
    return output.createTextNode(node.textContent ?? '')
  }
  if (!(node instanceof Element)) {
    return output.createDocumentFragment()
  }
  if (BLOCKED_TAGS.has(node.tagName)) {
    return output.createDocumentFragment()
  }

  const fragment = output.createDocumentFragment()
  if (!ALLOWED_TAGS.has(node.tagName)) {
    for (const child of Array.from(node.childNodes)) {
      fragment.append(sanitizeNode(child, output))
    }
    return fragment
  }

  const element = output.createElement(node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase())
  if (node.tagName === 'UL' || node.tagName === 'OL') {
    if (node.classList.contains('note-list-dashed')) {
      element.className = 'note-list-dashed'
    }
  }

  const style = cleanStyle(node.getAttribute('style') ?? '')
  if (style) {
    element.setAttribute('style', style)
  }
  if (node.tagName === 'FONT') {
    const fontSize = node.getAttribute('size')
    if (fontSize && FONT_SIZE_MAP[fontSize]) {
      element.setAttribute('style', `font-size: ${FONT_SIZE_MAP[fontSize]}`)
    }
  }

  for (const child of Array.from(node.childNodes)) {
    element.append(sanitizeNode(child, output))
  }
  fragment.append(element)
  return fragment
}

export function sanitizeRichTextHtml(html: string) {
  const source = new DOMParser().parseFromString(html, 'text/html')
  const output = document.implementation.createHTMLDocument('')
  const container = output.createElement('div')
  for (const child of Array.from(source.body.childNodes)) {
    container.append(sanitizeNode(child, output))
  }
  return container.innerHTML
}

export function contentToEditorHtml(content: string) {
  if (/<(?:blockquote|b|br|div|em|font|i|li|ol|p|span|strong|u|ul)\b/i.test(content)) {
    return sanitizeRichTextHtml(content)
  }
  return escapeHtml(content).replace(/\r?\n/g, '<br>')
}

export function richTextToPlainText(content: string) {
  const html = contentToEditorHtml(content)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|ol|p|ul)>/gi, '\n')
  const container = document.createElement('div')
  container.innerHTML = html
  return (container.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}
