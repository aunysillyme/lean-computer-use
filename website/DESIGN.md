# Reference design

Source: https://model-orchestrator.aunysillyme.dev/ and its install and commands pages.
Source files: model-orchestrator website at commit 205760296bb61082960552986181bfb3b9fa6196.
Captured and inspected with Chromium at desktop and mobile widths on 2026-10-26.

The reference supplies assets/site.css, assets/avatar.png and the navigation logic.
The landing shell follows landing.html. The document shell follows build.mjs.
Fonts and the head resource links follow content.mjs. Playback follows the
setupTrailer pattern in assets/trailer.js with local media and a pause button.

The copied CSS defines the exact colors, type, spacing, breakpoints and components:
background #050806, panel #0a100c, border #20382a, text #b6cfbf,
muted #8ba996, accent #3df07a and heading #e0f0e5.
Cormorant Garamond supplies headings. JetBrains Mono supplies body and UI text.
The desktop shell uses a sticky header and sidebar. Mobile uses a details accordion.
The hero, routing card, trust strip, feature columns, code panel, document cards,
proof table and footer share the reference classes. Product additions follow the
same tokens. The product process and captions come from the README.

Product differences are the owner-selected headline, app task flow, local trailer,
pause button, five sibling links, source-backed proof table and FAQ content.
The site keeps its existing privacy, discovery and structured-data contracts.
