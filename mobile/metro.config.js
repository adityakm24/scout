const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable fast network bundle delivery
config.transformer.minifierConfig = {
  mangle: false,
  compress: {
    reduce_funcs: false,
  },
};

module.exports = config;
