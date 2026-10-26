// Resource policy shared by the builder and checker.
export const fontStylesheet = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,500&family=JetBrains+Mono:wght@400;500;600&display=swap';
export const media = ['trailer.mp4', 'trailer.webm', 'trailer-poster.jpg'];
export const assets = ['site.css', 'site.js', 'navigation.js', 'trailer.js', 'avatar.png', 'poster.png', 'social-preview.svg', 'social-preview.png', ...media];
export const csp = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'self' https://fonts.googleapis.com; script-src 'self'; connect-src 'none'; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'";
// Only the selected stylesheet and the two font preconnects may leave the site.
export function fontLink(node) {
  if (node.name !== 'link') return false;
  const { rel, href } = node.attrs;
  return rel === 'stylesheet' && href === fontStylesheet
    || rel === 'preconnect' && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(href);
}
