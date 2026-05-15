const fs = require('fs');
const { SourceMapConsumer } = require('source-map');

async function run() {
  const mapData = fs.readFileSync('dist/assets/index-79rtdVlp.js.map', 'utf8');
  const consumer = await new SourceMapConsumer(mapData);
  const pos = consumer.originalPositionFor({
    line: 188,
    column: 49396
  });
  console.log(pos);
  consumer.destroy();
}
run();
