const path = require('path');
const fs = require('fs');
const webpack = require('webpack');
module.exports = {
  mode: 'development', devtool: false,
  entry: path.resolve(__dirname, 'smoke.js'),
  output: {path: __dirname, filename: 'smoke.bundle.js'},
  resolve: {extensions: ['.ts', '.js']},
  module: {rules: [{test: /\.ts$/, use: 'ts-loader', exclude: /node_modules/}]},
  plugins: [new webpack.DefinePlugin({
    __LOCAL_HTML_PARSER__: JSON.stringify(fs.readFileSync(path.resolve(__dirname, '../dist/browser.js'), 'utf8')),
    __SMOKE_HTML__: JSON.stringify(fs.readFileSync(path.resolve(__dirname, 'fixture.html'), 'utf8')),
  })],
};
