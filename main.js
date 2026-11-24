// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=17';
import { initSync } from './sync.js?v=17';
import './header.js?v=17';
import './home.js?v=17';
import './deck.js?v=17';
import './study.js?v=17';
import './exam.js?v=17';
import './me.js?v=17';
import './social.js?v=17';
import './admin.js?v=17';
import './ai.js?v=17';

route();
initSync();
