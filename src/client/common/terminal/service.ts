// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import { Disposable, Event, EventEmitter, Terminal, Uri } from 'vscode';
import '../../common/extensions';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { captureTelemetry } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { ITerminalManager } from '../application/types';
import { IConfigurationService, IDisposableRegistry } from '../types';
import { ITerminalActivator, ITerminalHelper, ITerminalService, TerminalShellType } from './types';

@injectable()
export class TerminalService implements ITerminalService, Disposable {
    private terminal?: Terminal;
    private terminalShellType!: TerminalShellType;
    private terminalClosed = new EventEmitter<void>();
    private terminalManager: ITerminalManager;
    private terminalHelper: ITerminalHelper;
    private terminalActivator: ITerminalActivator;
    public get onDidCloseTerminal(): Event<void> {
        return this.terminalClosed.event.bind(this.terminalClosed);
    }
    constructor(@inject(IServiceContainer) private serviceContainer: IServiceContainer,
        private resource?: Uri,
        private title: string = 'Python') {

        const disposableRegistry = this.serviceContainer.get<Disposable[]>(IDisposableRegistry);
        disposableRegistry.push(this);
        this.terminalHelper = this.serviceContainer.get<ITerminalHelper>(ITerminalHelper);
        this.terminalManager = this.serviceContainer.get<ITerminalManager>(ITerminalManager);
        this.terminalManager.onDidCloseTerminal(this.terminalCloseHandler, this, disposableRegistry);
        this.terminalActivator = this.serviceContainer.get<ITerminalActivator>(ITerminalActivator);
    }
    public dispose() {
        if (this.terminal) {
            this.terminal.dispose();
        }
    }
    public async sendCommand(command: string, args: string[]): Promise<void> {
        await this.ensureTerminal();
        const text = this.terminalHelper.buildCommandForTerminal(this.terminalShellType, command, args);
        this.terminal!.show(true);
        this.terminal!.sendText(text, true);
    }
    public async sendText(text: string): Promise<void> {
        await this.ensureTerminal();
        this.terminal!.show(true);
        this.terminal!.sendText(text);
    }
    public async show(preserveFocus: boolean = true): Promise<void> {
        await this.ensureTerminal(preserveFocus);
        this.terminal!.show(preserveFocus);
    }
    private async ensureTerminal(preserveFocus: boolean = true): Promise<void> {
        if (this.terminal) {
            return;
        }
        this.terminalShellType = this.terminalHelper.identifyTerminalShell(this.terminal);
        this.terminal = this.terminalManager.createTerminal({ name: this.title });

        // Sometimes the terminal takes some time to start up before it can start accepting input.
        await new Promise(resolve => setTimeout(resolve, 100));

        await this.terminalActivator.activateEnvironmentInTerminal(this.terminal!, this.resource, preserveFocus);

        this.terminal!.show(preserveFocus);

        this.sendTelemetry().ignoreErrors();
    }
    private terminalCloseHandler(terminal: Terminal) {
        if (terminal === this.terminal) {
            this.terminalClosed.fire();
            this.terminal = undefined;
        }
    }

    private async sendTelemetry() {
        const pythonPath = this.serviceContainer.get<IConfigurationService>(IConfigurationService).getSettings(this.resource).pythonPath;
        const interpreterInfo = await this.serviceContainer.get<IInterpreterService>(IInterpreterService).getInterpreterDetails(pythonPath);
        const pythonVersion = (interpreterInfo && interpreterInfo.version) ? interpreterInfo.version.raw : undefined;
        const interpreterType = interpreterInfo ? interpreterInfo.type : undefined;
        captureTelemetry(EventName.TERMINAL_CREATE, { terminal: this.terminalShellType, pythonVersion, interpreterType });
    }
}
