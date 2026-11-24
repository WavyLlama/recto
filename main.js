// Entry point: loads every view module, then starts the router and the sync.
import { route } from './core.js?v=13';
import { initSync } from './sync.js?v=13';
import './header.js?v=13';
import './home.js?v=13';
import './deck.js?v=13';
import './study.js?v=13';
import './me.js?v=13';
import './social.js?v=13';
import './admin.js?v=13';
import './ai.js?v=13';

route();
initSync();
