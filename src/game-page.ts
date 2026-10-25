// Entry for the generated /games/<id>/ pages (see scripts/seo.mjs). The page itself is static HTML.
import { trackShares } from './analytics';
import './style.css';
import './game-page.css';
import { attachFeedback } from './feedback';

attachFeedback(document.getElementById('feedback') as HTMLButtonElement, { currentGame: () => document.body.dataset.game });
trackShares(() => document.body.dataset.game);
