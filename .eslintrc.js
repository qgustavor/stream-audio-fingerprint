module.exports = {
    extends: ["airbnb-base", "plugin:@typescript-eslint/recommended"],
    parser: "@typescript-eslint/parser",
    plugins: ["@typescript-eslint"],
    globals: {
        "window": false,
        "document": false,
    },
    rules: {
        "import/prefer-default-export": 0,
        "object-curly-spacing": [2, "never"],
        "max-len": ["error", { "code": 120}],
    },
    settings: {
        'import/extensions': [".js", ".ts"],
        'import/parsers': {
          '@typescript-eslint/parser': [".ts"]
         },
         'import/resolver': {
             'node': {
                 'extensions': [".js", ".ts"]
             }
         }
    }
};
