// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=5';
import { initSync } from './sync.js?v=5';
import './header.js?v=5';
import './home.js?v=5';
import './deck.js?v=5';
import './study.js?v=5';
import './me.js?v=5';
import './social.js?v=5';
import './admin.js?v=5';
import './ai.js?v=5';

route();
initSync();
