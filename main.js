// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=10';
import { initSync } from './sync.js?v=10';
import './header.js?v=10';
import './home.js?v=10';
import './deck.js?v=10';
import './study.js?v=10';
import './me.js?v=10';
import './social.js?v=10';
import './admin.js?v=10';
import './ai.js?v=10';

route();
initSync();
