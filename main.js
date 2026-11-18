// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=8';
import { initSync } from './sync.js?v=8';
import './header.js?v=8';
import './home.js?v=8';
import './deck.js?v=8';
import './study.js?v=8';
import './me.js?v=8';
import './social.js?v=8';
import './admin.js?v=8';
import './ai.js?v=8';

route();
initSync();
