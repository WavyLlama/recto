// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=18';
import { initSync } from './sync.js?v=18';
import './header.js?v=18';
import './home.js?v=18';
import './deck.js?v=18';
import './study.js?v=18';
import './exam.js?v=18';
import './me.js?v=18';
import './social.js?v=18';
import './admin.js?v=18';
import './ai.js?v=18';

route();
initSync();
