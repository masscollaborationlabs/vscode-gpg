// The module 'vscode' contains the VS Code extensibility API
const vscode = require('vscode');
// GPG command wrapper
const gpg = require('./gpg.js');

const fs = require('fs');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Encrypt command
    let encSelectionDisp = vscode.commands.registerTextEditorCommand('extension.encryptSelection', encryptSelection);
    // Decrypt command
    let decSelectionDisp = vscode.commands.registerTextEditorCommand('extension.decryptSelection', decryptSelection);
    // Encrypt armored file command
    let encArmoredFileDisp = vscode.commands.registerCommand('extension.encryptArmoredFile', encryptArmored);
    // Decrypt file command
    let decFileDisp = vscode.commands.registerCommand('extension.decryptFile', decryptFile);

    // register commands
    context.subscriptions.push(encSelectionDisp);
    context.subscriptions.push(decSelectionDisp);
    context.subscriptions.push(encArmoredFileDisp);
    context.subscriptions.push(decFileDisp);
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {
}
exports.deactivate = deactivate;


/**
 * Encrypt text selection command
 *
 * @param {vscode.TextEditor} textEditor
 */
function encryptSelection(textEditor) {

    let selection = textEditor.selection;
    let text = textEditor.document.getText(selection);

    gpg.listKeys().then(
        publicKeys => publicKeys.map(
            /** @param {gpg.PublicKey} currentValue */
            currentValue => ({
                label: `<${currentValue.email}>`,
                description: `(${currentValue.key_id})`,
                detail: currentValue.name,
                key_id: currentValue.key_id,
                email: currentValue.email,
            })
        )
    ).then(
        options => vscode.window.showQuickPick(options, { placeHolder: "Select recipient" })
    ).then(
        /** @param {{email: string}} selected gpg key option */
        selected => gpg.encrypt(text, selected.email)
    ).then(encrypted => {

        textEditor.edit(edit => edit.replace(selection, encrypted));

        vscode.window.setStatusBarMessage('GPG Encrypted!', 2000);
    }).catch(err => console.error(err));
}

/**
 * Decrypt text selection command
 *
 * @param {vscode.TextEditor} textEditor
 */
function decryptSelection(textEditor)
{
    let selection = textEditor.selection;
    let text = textEditor.document.getText(selection);

    new Promise(function (resolve, reject) {
        // Getting passphrases from configuration as an object "email" =>""passphrase"
        /**
         * @type {{email: string, description: string, passphrase: string}[]} passphrases
        */
        let passphrases = vscode.workspace.getConfiguration('gpg').get('passphrases');

        let options = passphrases.map(currentValue => ({
            label: `<${currentValue.email}>`,
            description: currentValue.description ? `(${currentValue.description})` : '',
            passphrase: currentValue.passphrase,
        }));

        if (options && options.length) {
            vscode.window.showQuickPick(options, { placeHolder: "Select stored passphrase" }).then(selected => {
                selected ? resolve(selected.passphrase) : reject("no stored passphrase was selected")
            });
        } else {
            reject("there are no stored passphrases");
        }
    }).catch(() => {
        // Default behaviour ask for the passphrase
        return vscode.window.showInputBox({
            prompt: 'Provide your passphrase',
            placeHolder: 'My passphrase',
            password: true,
            validateInput: value => (value.length == 0) ? "Passphrase cannot be empty" : null
        });
    }).then(
        passphrase => {
            if (passphrase === undefined || passphrase.length === 0) {
                // Hitting Enter gets to here, which is not expected
                vscode.window.setStatusBarMessage('No passphrase provided', 2000);
                return Promise.reject("no passphrase provided")
            }
            return gpg.decrypt(text, passphrase)
        }
    ).then(
        decrypted => {
            textEditor.edit(editBuilder => editBuilder.replace(selection, decrypted));
            vscode.window.setStatusBarMessage('GPG Decrypted!', 2000);
        },
        error => { console.error("unable to decrypt text", error) }
    );
}

/**
 * Encrypt armored file command
 *
 * @param {vscode.Uri} uri
 */
function encryptArmored(uri) {

    let inputFilePath = uri.fsPath;

    let suffix = vscode.workspace.getConfiguration('gpg').get('encryptedFileSuffix');
    let destFilePath = `${inputFilePath}.${suffix}`;

    new Promise(function (resolve, reject) {

        if (!inputFilePath || !fs.existsSync(inputFilePath)) {
            vscode.window.showErrorMessage('Invalid file');
            reject(new Error('invalid file path: ' + inputFilePath));
            return;
        }

        if (fs.existsSync(destFilePath)) {
            vscode.window
                .showInformationMessage('Do you want to override ' + destFilePath, ...['Yes', 'No'])
                .then(value => {
                    if (value != 'Yes') {
                        reject('selected not to override file');
                    } else {
                        resolve(destFilePath);
                    }
                });
        } else {
            resolve(destFilePath);
        }
    }).then(
        () => gpg.listKeys()
    ).then(
        publicKeys => publicKeys.map(
            /** @param {gpg.PublicKey} currentValue */
            currentValue => ({
                label: `<${currentValue.email}>`,
                description: `(${currentValue.key_id})`,
                detail: currentValue.name,
                key_id: currentValue.key_id,
                email: currentValue.email,
            })
        )
    ).then(
        options => vscode.window.showQuickPick(options, { placeHolder: "Select recipient" })
    ).then(
        /** @param {{email: string}} selected gpg key option */
        selected => gpg.encryptFile(inputFilePath, destFilePath, selected.email)
    ).then(resultFile => {
        if (resultFile && fs.existsSync(resultFile)) {
            vscode.window.showTextDocument(vscode.Uri.file(resultFile));
            vscode.window.setStatusBarMessage('GPG Encrypted!', 2000);
        }
    }).catch(err => console.error("unable to encrypt file", err));
}

/**
 * Decrypt file command
 *
 * @param {vscode.Uri} uri
 */
function decryptFile(uri) {

    let inputFilePath = uri.fsPath;

    // Replace extension
    let destFilePath = inputFilePath.replace(/(\.gpg)?(\.asc)?$/g, '');

    //Checking if destination file already exists
    new Promise(function (resolve, reject) {

        if (!inputFilePath || !fs.existsSync(inputFilePath)) {
            vscode.window.showErrorMessage('Invalid file');
            reject(new Error('invalid file path: ' + inputFilePath));
            return;
        }

        if (fs.existsSync(destFilePath)) {
            vscode.window
                .showInformationMessage('Do you want to override ' + destFilePath, ...['Yes', 'No'])
                .then(value => {
                    if (value != 'Yes') {
                        reject('Selected not to override file');
                    } else {
                        resolve(destFilePath);
                    }
                });
        } else {
            resolve(destFilePath);
        }
    }).then(
        () => new Promise(function (resolve, reject) {
            // Getting passphrases from configuration as an object "email" =>""passphrase"
            /**
             * @type {{email: string, description: string, passphrase: string}[]} passphrases
            */
            let passphrases = vscode.workspace.getConfiguration('gpg').get('passphrases');

            let options = passphrases.map(currentValue => ({
                label: `<${currentValue.email}>`,
                description: currentValue.description ? `(${currentValue.description})` : '',
                passphrase: currentValue.passphrase,
            }));

            if (options && options.length) {
                vscode.window.showQuickPick(options, { placeHolder: "Select stored passphrase" }).then(selected => {
                    selected ? resolve(selected.passphrase) : reject("no stored passphrase was selected")
                });
            } else {
                reject("there are no stored passphrases");
            }
        }).catch(() => {
            // Default behaviour ask for the passphrase
            return vscode.window.showInputBox({
                prompt: 'Provide your passphrase',
                placeHolder: 'My passphrase',
                password: true,
                validateInput: value => (value.length == 0) ? "Passphrase cannot be empty" : null
            });
        })
    ).then(
        passphrase => {
            if (passphrase === undefined || passphrase.length === 0) {
                // Hitting Enter gets to here, which is not expected
                vscode.window.setStatusBarMessage('No passphrase provided', 2000);
                return Promise.reject("no passphrase provided")
            }
            return gpg.decryptFile(inputFilePath, destFilePath, passphrase);
        }
    ).then(
        resultFile => {
            if (resultFile && fs.existsSync(resultFile)) {
                vscode.window.showTextDocument(vscode.Uri.file(resultFile));
                vscode.window.setStatusBarMessage('GPG Decrypted!', 2000);
            }
        },
        error => console.error("unable to decrypt file", error)
    );
}
