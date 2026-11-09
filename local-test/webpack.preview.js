const path = require('path');
module.exports = {
  mode: 'development', devtool: false,
  entry: path.resolve(__dirname, 'preview.js'),
  output: {path: __dirname, filename: 'preview.bundle.js'},
  resolve: {extensions: ['.ts', '.js']},
  module: {rules: [{test: /\.(ts|js)$/, use: {loader: 'ts-loader', options: {transpileOnly: true, compilerOptions: {allowJs: true}}}, exclude: /node_modules/}]},
};
