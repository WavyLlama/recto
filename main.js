// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=16';
import { initSync } from './sync.js?v=16';
import './header.js?v=16';
import './home.js?v=16';
import './deck.js?v=16';
import './study.js?v=16';
import './exam.js?v=16';
import './me.js?v=16';
import './social.js?v=16';
import './admin.js?v=16';
import './ai.js?v=16';

route();
initSync();
