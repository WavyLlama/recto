// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=15';
import { initSync } from './sync.js?v=15';
import './header.js?v=15';
import './home.js?v=15';
import './deck.js?v=15';
import './study.js?v=15';
import './me.js?v=15';
import './social.js?v=15';
import './admin.js?v=15';
import './ai.js?v=15';

route();
initSync();
