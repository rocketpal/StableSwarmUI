
let models = {};
let cur_model = null;
let curModelWidth = 0, curModelHeight = 0;
let curModelMenuModel = null;
let curModelMenuBrowser = null;
let loraWeightPref = {};

function editModel(model, browser) {
    if (model == null) {
        return;
    }
    curModelMenuModel = model;
    curModelMenuBrowser = browser;
    let imageInput = getRequiredElementById('edit_model_image');
    imageInput.innerHTML = '';
    let enableImage = getRequiredElementById('edit_model_enable_image');
    enableImage.checked = false;
    enableImage.disabled = true;
    let curImg = document.getElementById('current_image_img');
    if (curImg) {
        let newImg = curImg.cloneNode(true);
        imageInput.appendChild(newImg);
        enableImage.checked = true;
        enableImage.disabled = false;
    }
    getRequiredElementById('edit_model_name').value = model.title || model.name;
    getRequiredElementById('edit_model_type').value = model.architecture || '';
    getRequiredElementById('edit_model_resolution').value = `${model.standard_width}x${model.standard_height}`;
    for (let val of ['description', 'author', 'usage_hint', 'date', 'license', 'trigger_phrase', 'tags']) {
        getRequiredElementById(`edit_model_${val}`).value = model[val] || '';
    }
    $('#edit_model_modal').modal('show');
}

function save_edit_model() {
    let model = curModelMenuModel;
    if (model == null) {
        console.log("Model do save: no model");
        return;
    }
    let resolution = getRequiredElementById('edit_model_resolution').value.split('x');
    let data = {
        'model': model.name,
        'title': getRequiredElementById('edit_model_name').value,
        'standard_width': parseInt(resolution[0]),
        'standard_height': parseInt(resolution[1]),
        'preview_image': ''
    };
    for (let val of ['author', 'type', 'description', 'usage_hint', 'date', 'license', 'trigger_phrase', 'tags']) {
        data[val] = getRequiredElementById(`edit_model_${val}`).value;
    }
    data.subtype = curModelMenuBrowser.subType;
    function complete() {
        genericRequest('EditModelMetadata', data, data => {
            curModelMenuBrowser.browser.update();
        });
        $('#edit_model_modal').modal('hide');
    }
    if (getRequiredElementById('edit_model_enable_image').checked) {
        var image = new Image();
        image.crossOrigin = 'Anonymous';
        image.onload = () => {
            let canvas = document.createElement('canvas');
            let context = canvas.getContext('2d');
            canvas.height = 256;
            canvas.width = 256;
            context.drawImage(image, 0, 0, 256, 256);
            let dataURL = canvas.toDataURL('image/jpeg');
            data['preview_image'] = dataURL;
            complete();
        };
        image.src = getRequiredElementById('edit_model_image').getElementsByTagName('img')[0].src;
    }
    else {
        complete();
    }
}

function close_edit_model() {
    $('#edit_model_modal').modal('hide');
}

function cleanModelName(name) {
    let index = name.lastIndexOf('/');
    if (index != -1) {
        name = name.substring(index + 1);
    }
    index = name.lastIndexOf('.');
    if (index != -1) {
        name = name.substring(0, index);
    }
    return name;
}

function sortModelName(a, b) {
    let aName = a.name.toLowerCase();
    let bName = b.name.toLowerCase();
    if (aName.endsWith('.safetensors') && !bName.endsWith('.safetensors')) {
        return -1;
    }
    if (!aName.endsWith('.safetensors') && bName.endsWith('.safetensors')) {
        return 1;
    }
    return aName.localeCompare(bName);
}

class ModelBrowserWrapper {
    constructor(subType, container, id, selectOne) {
        this.subType = subType;
        this.selectOne = selectOne;
        this.browser = new GenPageBrowserClass(container, this.listModelFolderAndFiles.bind(this), id, 'Cards', this.describeModel.bind(this), this.selectModel.bind(this));
    }

    listModelFolderAndFiles(path, isRefresh, callback, depth) {
        let prefix = path == '' ? '' : (path.endsWith('/') ? path : `${path}/`);
        genericRequest('ListModels', {'path': path, 'depth': depth, 'subtype': this.subType}, data => {
            let files = data.files.sort(sortModelName).map(f => { return { 'name': `${prefix}${f.name}`, 'data': f }; });
            if (this.subType == 'VAE') {
                let noneFile = {
                    'name': `None`,
                    'data': {
                        'name': 'None',
                        'title': 'None',
                        'author': '(Internal)',
                        'architecture': 'VAE',
                        'class': 'VAE',
                        'description': 'Use the VAE built-in to your Stable Diffusion model',
                        'preview_image': '/imgs/none.jpg',
                        'is_safetensors': true,
                        standard_width: 0,
                        standard_height: 0
                    }
                };
                files = [noneFile].concat(files);
            }
            callback(data.folders.sort((a, b) => a.localeCompare(b)), files);
        });
    }

    describeModel(model) {
        let description = '';
        let buttons = [];
        if (this.subType == 'Stable-Diffusion') {
            let buttonLoad = () => {
                directSetModel(model.data);
                makeWSRequestT2I('SelectModelWS', {'model': model.data.name}, data => {
                    this.browser.navigate(lastModelDir);
                });
            }
            buttons = [
                { label: 'Load Now', onclick: buttonLoad }
            ];
        }
        let name = cleanModelName(model.data.name);
        if (model.data.is_safetensors) {
            let getLine = (label, val) => `<b>${label}:</b> ${val == null ? "(Unset)" : escapeHtml(val)}<br>`;
            if (this.subType == 'LoRA' || this.subType == 'Stable-Diffusion') {
                description = `<span class="model_filename">${escapeHtml(name)}</span><br>${getLine("Title", model.data.title)}${getLine("Author", model.data.author)}${getLine("Type", model.data.class)}${getLine("Resolution", `${model.data.standard_width}x${model.data.standard_height}`)}${getLine("Description", model.data.description)}`;
            }
            else {
                description = `<span class="model_filename">${escapeHtml(name)}</span><br>${getLine("Title", model.data.title)}${getLine("Author", model.data.author)}${getLine("Type", model.data.class)}${getLine("Description", model.data.description)}`;
            }
            buttons.push({ label: 'Edit Metadata', onclick: () => editModel(model.data, this) });
        }
        else {
            description = `${escapeHtml(name)}.ckpt<br>(Metadata only available for 'safetensors' models.)<br><b>WARNING:</b> 'ckpt' pickle files can contain malicious code! Use with caution.<br>`;
        }
        let selector = 'current_model';
        switch (this.subType) {
            case 'Stable-Diffusion': selector = 'current_model'; break;
            case 'VAE': selector = 'input_vae'; break;
            case 'LoRA': selector = 'input_loras'; break;
            case 'ControlNet': selector = 'input_controlnetmodel'; break;
        }
        let isSelected;
        let selectorElem = document.getElementById(selector);
        if (!selectorElem) {
            isSelected = false;
        }
        else if (this.subType == 'VAE' && !document.getElementById('input_vae_toggle').checked) {
            isSelected = model.data.name == 'None';
        }
        else if (this.subType == 'LoRA') {
            isSelected = [...selectorElem.selectedOptions].map(option => option.value).filter(value => value == model.data.name).length > 0;
        }
        else {
            isSelected = selectorElem.value == model.data.name;
        }
        let className = isSelected ? 'model-selected' : (model.data.loaded ? 'model-loaded' : '');
        let searchable = `${name}, ${description}, ${model.data.license}, ${model.data.architecture}, ${model.data.usage_hint}, ${model.data.trigger_phrase}, ${model.data.merged_from}, ${model.data.tags}`;
        return { name, description, buttons, 'image': model.data.preview_image, className, searchable };
    }

    selectModel(model) {
        this.selectOne(model);
        this.browser.rerender();
    }
}

let sdModelBrowser = new ModelBrowserWrapper('Stable-Diffusion', 'model_list', 'modelbrowser', (model) => { directSetModel(model.data); });
let sdVAEBrowser = new ModelBrowserWrapper('VAE', 'vae_list', 'sdvaebrowser', (vae) => { directSetVae(vae.data); });
let sdLoraBrowser = new ModelBrowserWrapper('LoRA', 'lora_list', 'sdlorabrowser', (lora) => { toggleSelectLora(lora.data.name); });
let sdEmbedBrowser = new ModelBrowserWrapper('Embedding', 'embedding_list', 'sdembedbrowser', (embed) => {});
let sdControlnetBrowser = new ModelBrowserWrapper('ControlNet', 'controlnet_list', 'sdcontrolnetbrowser', (controlnet) => { setControlNet(controlnet.data); });

function setControlNet(model) {
    let input = document.getElementById('input_controlnetmodel');
    if (!input) {
        return;
    }
    forceSetDropdownValue(input, model.name);
    let group = document.getElementById('input_group_content_controlnet_toggle');
    if (group) {
        group.checked = true;
    }
}

function initialModelListLoad() {
    for (let browser of [sdModelBrowser, sdVAEBrowser, sdLoraBrowser, sdEmbedBrowser, sdControlnetBrowser]) {
        browser.browser.navigate('');
    }
}

function reapplyLoraWeights() {
    let valSet = [...getRequiredElementById('input_loras').selectedOptions].map(option => option.value);
    let weights = getRequiredElementById('input_loraweights').value.split(',');
    if (weights.length != valSet.length) {
        console.log("Ignoring invalid LoRA weights value.");
        return;
    }
    let viewable = [...getRequiredElementById('current_lora_list_view').children];
    for (let i = 0; i < valSet.length; i++) {
        loraWeightPref[valSet[i]] = weights[i];
        let entry = viewable.filter(elem => elem.dataset.lora_name == valSet[i]);
        if (entry.length == 1) {
            entry[0].querySelector('.lora-weight-input').value = weights[i];
        }
    }
}

function updateLoraWeights() {
    let valSet = [...getRequiredElementById('input_loras').selectedOptions].map(option => option.value);
    let inputWeights = getRequiredElementById('input_loraweights');
    inputWeights.value = valSet.map(lora => loraWeightPref[lora] || 1).join(',');
    getRequiredElementById('input_loraweights_toggle').checked = valSet.length > 0;
    inputWeights.dispatchEvent(new Event('change'));
    doToggleEnable('input_loraweights');
}

function updateLoraList() {
    let view = getRequiredElementById('current_lora_list_view');
    let loraElem = document.getElementById('input_loras');
    if (!loraElem) {
        return;
    }
    let currentLoras = [...loraElem.selectedOptions].map(option => option.value);
    view.innerHTML = '';
    for (let lora of currentLoras) {
        let div = createDiv(null, 'preset-in-list');
        div.dataset.lora_name = lora;
        div.innerText = lora;
        let weightInput = document.createElement('input');
        weightInput.className = 'lora-weight-input';
        weightInput.type = 'number';
        weightInput.min = -10;
        weightInput.max = 10;
        weightInput.step = 0.1;
        weightInput.value = loraWeightPref[lora] || 1;
        weightInput.addEventListener('change', () => {
            loraWeightPref[lora] = weightInput.value;
            updateLoraWeights();
        });
        let removeButton = createDiv(null, 'preset-remove-button');
        removeButton.innerHTML = '&times;';
        removeButton.title = "Remove this LoRA";
        removeButton.addEventListener('click', () => {
            toggleSelectLora(lora);
            updateLoraList();
            sdLoraBrowser.browser.rerender();
        });
        div.appendChild(weightInput);
        div.appendChild(removeButton);
        view.appendChild(div);
    }
    getRequiredElementById('current_loras_wrapper').style.display = currentLoras.length > 0 ? 'inline-block' : 'none';
    getRequiredElementById('lora_info_slot').innerText = ` (${currentLoras.length})`;
}

function toggleSelectLora(lora) {
    let loraInput = document.getElementById('input_loras');
    if (!loraInput) {
        showError("Cannot set LoRAs currently. Are you using a custom workflow? LoRAs only work in the default mode.");
        return;
    }
    let selected = [...loraInput.selectedOptions].map(option => option.value);
    if (selected.includes(lora)) {
        selected = selected.filter(l => l != lora);
    }
    else {
        selected.push(lora);
    }
    $(loraInput).val(selected);
    $(loraInput).trigger('change');
    getRequiredElementById('input_loras_toggle').checked = selected.length > 0;
    doToggleEnable('input_loras');
    loraInput.dispatchEvent(new Event('change'));
    updateLoraWeights();
    updateLoraList();
}

function directSetVae(vae) {
    let toggler = getRequiredElementById('input_vae_toggle');
    if (!vae || vae.name == 'None') {
        toggler.checked = false;
        doToggleEnable('input_vae');
        return;
    }
    forceSetDropdownValue('input_vae', vae.name);
    toggler.checked = true;
    doToggleEnable('input_vae');
}

function directSetModel(model) {
    if (!model) {
        return;
    }
    if (model.name) {
        forceSetDropdownValue('input_model', model.name);
        forceSetDropdownValue('current_model', model.name);
        setCookie('selected_model', `${model.name},${model.standard_width},${model.standard_height}`, 90);
        curModelWidth = model.standard_width;
        curModelHeight = model.standard_height;
    }
    else if (model.includes(',')) {
        let [name, width, height] = model.split(',');
        forceSetDropdownValue('input_model', name);
        forceSetDropdownValue('current_model', name);
        setCookie('selected_model', `${name},${width},${height}`, 90);
        curModelWidth = parseInt(width);
        curModelHeight = parseInt(height);
    }
    let aspect = document.getElementById('input_aspectratio');
    if (aspect) {
        aspect.dispatchEvent(new Event('change'));
    }
}

function setCurrentModel(callback) {
    let currentModel = getRequiredElementById('current_model');
    if (currentModel.value == '') {
        genericRequest('ListLoadedModels', {}, data => {
            if (data.models.length > 0) {
                directSetModel(data.models[0]);
            }
            if (callback) {
                callback();
            }
        });
    }
    else {
        if (callback) {
            callback();
        }
    }
}

let noModelChangeDup = false;

function currentModelChanged() {
    if (noModelChangeDup) {
        return;
    }
    let name = getRequiredElementById('current_model').value;
    if (name == '') {
        return;
    }
    genericRequest('DescribeModel', {'modelName': name}, data => {
        noModelChangeDup = true;
        directSetModel(data.model);
        noModelChangeDup = false;
    });
}

getRequiredElementById('current_model').addEventListener('change', currentModelChanged);
