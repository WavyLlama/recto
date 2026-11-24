// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=11';
import { initSync } from './sync.js?v=11';
import './header.js?v=11';
import './home.js?v=11';
import './deck.js?v=11';
import './study.js?v=11';
import './me.js?v=11';
import './social.js?v=11';
import './admin.js?v=11';
import './ai.js?v=11';

route();
initSync();
