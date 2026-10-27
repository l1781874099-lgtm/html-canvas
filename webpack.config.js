const webpack = require("webpack");
const HtmlWebpackInlineSourcePlugin = require("html-webpack-inline-source-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const path = require("path");
const fs = require("fs");

module.exports = (env, argv) => {
  const baseConfig = {
    mode: argv.mode === "production" ? "production" : "development",
    devtool: false,
    module: {
      rules: [
        { test: /\.tsx?$/, use: "ts-loader", exclude: /node_modules/ },
        {
          test: /\.css$/,
          loader: [{ loader: "style-loader" }, { loader: "css-loader" }],
        },
        {
          test: /\.(png|jpg|gif|webp|svg)$/,
          loader: [{ loader: "url-loader" }],
        },
      ],
    },
    resolve: { extensions: [".tsx", ".ts", ".jsx", ".js"] },
    output: {
      path: path.resolve(__dirname, "dist"),
    },
    plugins: [
      new webpack.EnvironmentPlugin({
        NODE_ENV: "production",
        API_KEY: null,
      }),
    ],
  };

  return [
    {
      ...baseConfig,
      entry: {
        ui: "./plugin/ui.tsx", // The entry point for your UI code
        code: "./plugin/code.ts",
      },
      output: {
        ...baseConfig.output,
        filename: "[name].js",
      },
      plugins: [
        ...baseConfig.plugins,
        new webpack.DefinePlugin({
          __LOCAL_HTML_PARSER__: JSON.stringify(
            fs.existsSync(path.join(__dirname, 'dist/browser.js'))
              ? fs.readFileSync(path.join(__dirname, 'dist/browser.js'), 'utf8')
              : ''
          ),
        }),
        new HtmlWebpackPlugin({
          template: "./plugin/ui.html",
          filename: "ui.html",
          inlineSource: ".(js)$",
          chunks: ["ui"],
        }),
        new HtmlWebpackInlineSourcePlugin(),
      ],
    },
    {
      ...baseConfig,
      entry: "./lib/html-to-figma/index.ts",
      output: {
        ...baseConfig.output,
        library: "htmlToFigma",
        libraryTarget: "var",
        filename: "browser.js",
      },
    },
    {
      ...baseConfig,
      optimization: {
        minimize: false,
      },
      entry: "./lib/html-to-figma/index.ts",
      output: {
        ...baseConfig.output,
        library: "htmlToFigma",
        libraryExport: "htmlToFigma",
        libraryTarget: "commonjs",
        filename: "main.js",
      },
    },
  ];
};
