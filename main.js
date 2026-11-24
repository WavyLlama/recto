// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=14';
import { initSync } from './sync.js?v=14';
import './header.js?v=14';
import './home.js?v=14';
import './deck.js?v=14';
import './study.js?v=14';
import './me.js?v=14';
import './social.js?v=14';
import './admin.js?v=14';
import './ai.js?v=14';

route();
initSync();
