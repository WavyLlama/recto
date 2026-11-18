// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=6';
import { initSync } from './sync.js?v=6';
import './header.js?v=6';
import './home.js?v=6';
import './deck.js?v=6';
import './study.js?v=6';
import './me.js?v=6';
import './social.js?v=6';
import './admin.js?v=6';
import './ai.js?v=6';

route();
initSync();
