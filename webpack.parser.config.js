const config = require('./webpack.config');
// Build the browser parser first so it can be embedded in the isolated renderer.
module.exports = (env, argv) => config(env, argv)[1];
