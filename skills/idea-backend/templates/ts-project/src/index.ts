import { greet } from './lib/greet.js';

const name = process.env['GREET_NAME'] ?? 'world';

console.log(greet(name));
