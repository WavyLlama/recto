// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=12';
import { initSync } from './sync.js?v=12';
import './header.js?v=12';
import './home.js?v=12';
import './deck.js?v=12';
import './study.js?v=12';
import './me.js?v=12';
import './social.js?v=12';
import './admin.js?v=12';
import './ai.js?v=12';

route();
initSync();
