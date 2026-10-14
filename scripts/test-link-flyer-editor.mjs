import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../public/admin/builder.html', import.meta.url), 'utf8');
const helpers = html.slice(html.indexOf('    let newFlyerTimer;'), html.indexOf('    function updateMeta('));
let resolve, timer;
const form = { newLinkUrl: { value: '', dataset: {} }, newLinkImageUrl: { value: '', dataset: {} } };
const el = { element_type: 'link', url: 'https://kongnightlife.com/p/old', metadata: {} };
const context = vm.createContext({
  elements: [el], selectedElement: el,
  LinkFlyers: { resolve: () => new Promise(done => { resolve = done; }) },
  document: { getElementById: id => id === "settingsPanel" ? { querySelector: () => null } : form[id] },
  setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = null; },
  renderElements: () => {}, renderSettingsPanel: () => {}, showToast: () => {}
});
vm.runInContext(helpers, context);
let job = context.fillLinkFlyer(el);
el.url = 'https://kongnightlife.com/p/new';
resolve('https://kongnightlife.com/old.png'); await job;
assert.equal(el.metadata.image_url, undefined, 'Reject image from old URL');
job = context.fillLinkFlyer(el);
el.metadata.image_url = '/images/manual.png';
resolve('https://kongnightlife.com/auto.png'); await job;
assert.equal(el.metadata.image_url, '/images/manual.png', 'Preserve manual edit during request');
el.metadata = { image_url: 'https://kongnightlife.com/old.png', image_source_url: el.url };
context.updateField('url', 'https://kongnightlife.com/p/next');
assert.equal(el.metadata.image_url, undefined, 'Clear previous automatic image');
timer(); resolve('https://kongnightlife.com/next.png'); await vm.runInContext("Promise.all([...flyerJobs])", context);
assert.equal(el.metadata.image_url, 'https://kongnightlife.com/next.png');
form.newLinkUrl.value = 'https://kongnightlife.com/p/first';
job = context.fillNewLinkFlyer(); form.newLinkUrl.value = 'https://kongnightlife.com/p/second';
resolve('https://kongnightlife.com/first.png'); await job;
assert.equal(form.newLinkImageUrl.value, '');
job = context.fillNewLinkFlyer(); resolve('https://kongnightlife.com/second.png'); await job;
assert.equal(form.newLinkImageUrl.dataset.sourceUrl, form.newLinkUrl.value);
form.newLinkUrl.value = 'https://kongnightlife.com/p/third'; context.queueNewLinkFlyer();
assert.equal(form.newLinkImageUrl.value, '');
form.newLinkImageUrl.value = '/images/manual.png'; context.queueNewLinkFlyer();
assert.equal(form.newLinkImageUrl.value, '/images/manual.png');
console.log('PASS: stale responses, manual edits, URL changes, automatic modal images, manual modal images');

const updateFlyer = html.slice(html.indexOf('    function updateFlyer('), html.indexOf('    async function createLink()'));
vm.runInContext(updateFlyer, context);
context.LinkFlyers.safeImageUrl = value => value.startsWith('https://') && value.length > 8;
el.metadata = {};
job = context.fillLinkFlyer(el);
context.updateFlyer('h');
resolve('https://kongnightlife.com/auto.png'); await job;
assert.equal(el.metadata.image_url, undefined, 'Partial manual typing cancels automatic lookup');
const creation = html.slice(html.indexOf('    async function createLink()'), html.indexOf('    async function createPromo()'));
const modals = html.slice(html.indexOf('    function openModal('), html.indexOf('    function selectStyle('));
let creations = 0;
Object.assign(form, {
  linkModal: { classList: { add() {}, remove() {} } },
  newLinkIconGrid: { querySelector: () => null }, newLinkTitle: { value: 'Test' },
  newLinkSubtitle: { value: '' }, newLinkStyle: { value: 'filled' }, newLinkColor: { value: '#000000' }
});
form.newLinkImageUrl.value = ''; form.newLinkImageUrl.dataset = {};
context.createElementAPI = async () => { creations++; };
context.LinkFlyers.imageUrl = () => '';
vm.runInContext(modals + creation, context);
context.openModal('linkModal');
job = context.createLink(); context.closeModal('linkModal');
resolve('https://kongnightlife.com/auto.png'); await job;
assert.equal(creations, 0, 'Cancel during lookup prevents creation');
context.openModal('linkModal');
job = context.createLink(); resolve('https://kongnightlife.com/auto.png'); await job;
assert.equal(creations, 1);
console.log('PASS: partial manual edits, cancel during lookup, successful creation');
const save = html.slice(html.indexOf('    async function saveAllChanges()'), html.indexOf('    function addElement('));
let saved;
context.fetch = async (_, options) => { saved = JSON.parse(options.body); return { ok: true }; };
context.LinkFlyers.imageUrl = link => link.metadata?.image_url || '';
vm.runInContext(save, context);
el.metadata = {};
context.updateField('url', 'https://kongnightlife.com/p/save-immediately');
job = context.saveAllChanges(); resolve('https://kongnightlife.com/saved.png'); await job;
assert.equal(saved.metadata.image_url, 'https://kongnightlife.com/saved.png', 'Save before debounce must include extracted photo');
console.log('PASS: immediate save includes resolved artwork');
