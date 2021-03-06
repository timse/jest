'use strict';

const fs = require('fs')
const glob = require('glob');
const mkdirp = require('mkdirp');
const optimist = require('optimist');
const path = require('path');
const argv = optimist.argv;

function splitHeader(content) {
  const lines = content.split('\n');
  let i = 1;
  for (; i < lines.length - 1; ++i) {
    if (lines[i] === '---') {
      break;
    }
  }
  return {
    header: lines.slice(1, i + 1).join('\n'),
    content: lines.slice(i + 1).join('\n')
  };
}

function globEach(pattern, cb) {
  glob(pattern, (err, files) => {
    if (err) {
      console.error(err);
      return;
    }
    files.forEach(cb);
  });
}

function rmFile(file) {
  try {
    fs.unlinkSync(file);
  } catch(e) {
    /* seriously, unlink throws when the file doesn't exist :( */
  }
}

function backtickify(str) {
  const escaped = '`' + str.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
  // Replace require( with require\( so node-haste doesn't replace example
  // require calls in the docs
  return escaped.replace(/require\(/g, 'require\\(');
}


// Extract markdown metadata header
function extractMetadata(content) {
  const metadata = {};
  const both = splitHeader(content);
  const lines = both.header.split('\n');
  for (let i = 0; i < lines.length - 1; ++i) {
    const keyvalue = lines[i].split(':');
    const key = keyvalue[0].trim();
    const value = keyvalue.slice(1).join(':').trim();
    // Handle the case where you have "Community #10"
    try { value = JSON.parse(value); } catch(e) { }
    metadata[key] = value;
  }
  return {metadata: metadata, rawContent: both.content};
}

function buildFile(layout, metadata, rawContent) {
  return [
    '/**',
    ' * @generated',
    ' */',
    'var React = require("React");',
    'var Layout = require("' + layout + '");',
    rawContent && 'var content = ' + backtickify(rawContent) + ';',
    'var Post = React.createClass({',
    rawContent && '  statics: { content: content },',
    '  render: function() {',
    '    return (',
    '      <Layout metadata={' + JSON.stringify(metadata) + '}>',
    rawContent && '        {content}',
    '      </Layout>',
    '    );',
    '  }',
    '});',
    'module.exports = Post;'
  ].filter(e => e).join('\n');
}

function writeFileAndCreateFolder(file, content) {
  mkdirp.sync(file.replace(new RegExp('/[^/]*$'), ''));
  fs.writeFileSync(file, content);
}

function execute() {
  const DOCS_MD_DIR = '../docs/';
  const BLOG_MD_DIR = '../blog/';

  globEach('src/jest/docs/*.*', rmFile);
  globEach('src/jest/blog/*.*', rmFile);

  const gettingStarted = splitHeader(fs.readFileSync(DOCS_MD_DIR + 'GettingStarted.md', 'utf8')).content
    .replace(/\(\/jest\//g, '(https://facebook.github.io/jest/');

  let readme = fs.readFileSync('../README.md', 'utf8');
  const guideStart = '<generated_getting_started_start />';
  const guideEnd = '<generated_getting_started_end />';
  readme = readme.slice(0, readme.indexOf(guideStart) + guideStart.length) +
    gettingStarted +
    readme.slice(readme.indexOf(guideEnd));
  fs.writeFileSync('../README.md', readme);

  glob(DOCS_MD_DIR + '**/*.*', (er, files) => {
    const metadatas = {
      files: [],
    };

    files.forEach(file => {
      const extension = path.extname(file);
      if (extension === '.md' || extension === '.markdown') {
        const res = extractMetadata(fs.readFileSync(file, 'utf8'));
        const metadata = res.metadata;
        const rawContent = res.rawContent;
        metadata.source = path.basename(file);
        metadatas.files.push(metadata);

        if (metadata.permalink.match(/^https?:/)) {
          return;
        }

        // Create a dummy .js version that just calls the associated layout
        const layout = metadata.layout[0].toUpperCase() + metadata.layout.substr(1) + 'Layout';

        writeFileAndCreateFolder(
          'src/jest/' + metadata.permalink.replace(/\.html$/, '.js'),
          buildFile(layout, metadata, rawContent)
        );
      }

      if (extension === '.json') {
        const content = fs.readFileSync(file, 'utf8');
        metadatas[path.basename(file, '.json')] = JSON.parse(content);
      }
    });

    fs.writeFileSync(
      'core/metadata.js',
      '/**\n' +
      ' * @generated\n' +
      ' * @providesModule Metadata\n' +
      ' */\n' +
      'module.exports = ' + JSON.stringify(metadatas, null, 2) + ';'
    );
  });

  glob(BLOG_MD_DIR + '**/*.*', (er, files) => {
    const metadatas = {
      files: [],
    };

    files.sort().reverse().forEach(file => {
      // Transform
      //   2015-08-13-blog-post-name-0.5.md
      // into
      //   2015/08/13/blog-post-name-0-5.html
      const filePath = path.basename(file)
        .replace('-', '/')
        .replace('-', '/')
        .replace('-', '/')
        // react-middleware is broken with files that contains multiple . like react-0.14.js
        .replace(/\./g, '-')
        .replace(/\-md$/, '.html');

      const res = extractMetadata(fs.readFileSync(file, {encoding: 'utf8'}));
      const rawContent = res.rawContent;
      const metadata = Object.assign({path: filePath, content: rawContent}, res.metadata);

      metadata.id = metadata.title;
      metadatas.files.push(metadata);

      writeFileAndCreateFolder(
        'src/jest/blog/' + filePath.replace(/\.html$/, '.js'),
        buildFile('BlogPostLayout', metadata, rawContent)
      );
    });

    const perPage = 5;
    for (let page = 0; page < Math.ceil(metadatas.files.length / perPage); ++page) {
      writeFileAndCreateFolder(
        'src/jest/blog' + (page > 0 ? '/page' + (page + 1) : '') + '/index.js',
        buildFile('BlogPageLayout', { page: page, perPage: perPage })
      );
    }

    fs.writeFileSync(
      'core/metadata-blog.js',
      '/**\n' +
      ' * @generated\n' +
      ' * @providesModule MetadataBlog\n' +
      ' */\n' +
      'module.exports = ' + JSON.stringify(metadatas, null, 2) + ';'
    );
  });
}

if (argv.convert) {
  console.log('convert!')
  execute();
}

module.exports = execute;
