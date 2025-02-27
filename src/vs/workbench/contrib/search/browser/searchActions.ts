/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { ITreeNavigator } from 'vs/base/browser/ui/tree/tree';
import { Action } from 'vs/base/common/actions';
import { createKeybinding, ResolvedKeybinding } from 'vs/base/common/keybindings';
import { isWindows, OS } from 'vs/base/common/platform';
import * as nls from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ICommandHandler, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILabelService } from 'vs/platform/label/common/label';
import { getSelectionKeyboardEvent, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IViewsService } from 'vs/workbench/common/views';
import { searchRemoveIcon, searchReplaceAllIcon, searchReplaceIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { SearchView } from 'vs/workbench/contrib/search/browser/searchView';
import * as Constants from 'vs/workbench/contrib/search/common/constants';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { ISearchHistoryService } from 'vs/workbench/contrib/search/common/searchHistoryService';
import { arrayContainsElementOrParent, FileMatch, FolderMatch, FolderMatchNoRoot, FolderMatchWithResource, FolderMatchWorkspaceRoot, Match, RenderableMatch, searchComparer, searchMatchComparer, SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { OpenEditorCommandId } from 'vs/workbench/contrib/searchEditor/browser/constants';
import { SearchEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditor';
import { OpenSearchEditorArgs } from 'vs/workbench/contrib/searchEditor/browser/searchEditor.contribution';
import { SearchEditorInput } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ISearchConfiguration, ISearchConfigurationProperties, VIEW_ID } from 'vs/workbench/services/search/common/search';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';

export function isSearchViewFocused(viewsService: IViewsService): boolean {
	const searchView = getSearchView(viewsService);
	const activeElement = document.activeElement;
	return !!(searchView && activeElement && DOM.isAncestor(activeElement, searchView.getContainer()));
}

export function appendKeyBindingLabel(label: string, inputKeyBinding: number | ResolvedKeybinding | undefined, keyBindingService2: IKeybindingService): string {
	if (typeof inputKeyBinding === 'number') {
		const keybinding = createKeybinding(inputKeyBinding, OS);
		if (keybinding) {
			const resolvedKeybindings = keyBindingService2.resolveKeybinding(keybinding);
			return doAppendKeyBindingLabel(label, resolvedKeybindings.length > 0 ? resolvedKeybindings[0] : undefined);
		}
		return doAppendKeyBindingLabel(label, undefined);
	} else {
		return doAppendKeyBindingLabel(label, inputKeyBinding);
	}
}

export function openSearchView(viewsService: IViewsService, focus?: boolean): Promise<SearchView | undefined> {
	return viewsService.openView(VIEW_ID, focus).then(view => (view as SearchView ?? undefined));
}

export function getSearchView(viewsService: IViewsService): SearchView | undefined {
	return viewsService.getActiveViewWithId(VIEW_ID) as SearchView ?? undefined;
}

function doAppendKeyBindingLabel(label: string, keyBinding: ResolvedKeybinding | undefined): string {
	return keyBinding ? label + ' (' + keyBinding.getLabel() + ')' : label;
}

export const toggleCaseSensitiveCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	searchView?.toggleCaseSensitive();
};

export const toggleWholeWordCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	searchView?.toggleWholeWords();
};

export const toggleRegexCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	searchView?.toggleRegex();
};

export const togglePreserveCaseCommand = (accessor: ServicesAccessor) => {
	const searchView = getSearchView(accessor.get(IViewsService));
	searchView?.togglePreserveCase();
};

export class FocusNextInputAction extends Action {

	static readonly ID = 'search.focus.nextInputBox';

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			(this.editorService.activeEditorPane as SearchEditor).focusNextInput();
		}

		const searchView = getSearchView(this.viewsService);
		searchView?.focusNextInputBox();
	}
}

export class FocusPreviousInputAction extends Action {

	static readonly ID = 'search.focus.previousInputBox';

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			(this.editorService.activeEditorPane as SearchEditor).focusPrevInput();
		}

		const searchView = getSearchView(this.viewsService);
		searchView?.focusPreviousInputBox();
	}
}

export abstract class FindOrReplaceInFilesAction extends Action {

	constructor(id: string, label: string, protected viewsService: IViewsService,
		private expandSearchReplaceWidget: boolean
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		return openSearchView(this.viewsService, false).then(openedView => {
			if (openedView) {
				const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
				searchAndReplaceWidget.toggleReplace(this.expandSearchReplaceWidget);

				const updatedText = openedView.updateTextFromFindWidgetOrSelection({ allowUnselectedWord: !this.expandSearchReplaceWidget });
				openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
			}
		});
	}
}
export interface IFindInFilesArgs {
	query?: string;
	replace?: string;
	preserveCase?: boolean;
	triggerSearch?: boolean;
	filesToInclude?: string;
	filesToExclude?: string;
	isRegex?: boolean;
	isCaseSensitive?: boolean;
	matchWholeWord?: boolean;
	useExcludeSettingsAndIgnoreFiles?: boolean;
	onlyOpenEditors?: boolean;
}
export const FindInFilesCommand: ICommandHandler = (accessor, args: IFindInFilesArgs = {}) => {
	const searchConfig = accessor.get(IConfigurationService).getValue<ISearchConfiguration>().search;
	const mode = searchConfig.mode;
	if (mode === 'view') {
		const viewsService = accessor.get(IViewsService);
		openSearchView(viewsService, false).then(openedView => {
			if (openedView) {
				const searchAndReplaceWidget = openedView.searchAndReplaceWidget;
				searchAndReplaceWidget.toggleReplace(typeof args.replace === 'string');
				let updatedText = false;
				if (typeof args.query === 'string') {
					openedView.setSearchParameters(args);
				} else {
					updatedText = openedView.updateTextFromFindWidgetOrSelection({ allowUnselectedWord: typeof args.replace !== 'string' });
				}
				openedView.searchAndReplaceWidget.focus(undefined, updatedText, updatedText);
			}
		});
	} else {
		const convertArgs = (args: IFindInFilesArgs): OpenSearchEditorArgs => ({
			location: mode === 'newEditor' ? 'new' : 'reuse',
			query: args.query,
			filesToInclude: args.filesToInclude,
			filesToExclude: args.filesToExclude,
			matchWholeWord: args.matchWholeWord,
			isCaseSensitive: args.isCaseSensitive,
			isRegexp: args.isRegex,
			useExcludeSettingsAndIgnoreFiles: args.useExcludeSettingsAndIgnoreFiles,
			onlyOpenEditors: args.onlyOpenEditors,
			showIncludesExcludes: !!(args.filesToExclude || args.filesToExclude || !args.useExcludeSettingsAndIgnoreFiles),
		});
		accessor.get(ICommandService).executeCommand(OpenEditorCommandId, convertArgs(args));
	}
};

export class ReplaceInFilesAction extends FindOrReplaceInFilesAction {

	static readonly ID = 'workbench.action.replaceInFiles';
	static readonly LABEL = nls.localize('replaceInFiles', "Replace in Files");

	constructor(id: string, label: string,
		@IViewsService viewsService: IViewsService) {
		super(id, label, viewsService, /*expandSearchReplaceWidget=*/true);
	}
}

export class CloseReplaceAction extends Action {

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		const searchView = getSearchView(this.viewsService);
		if (searchView) {
			searchView.searchAndReplaceWidget.toggleReplace(false);
			searchView.searchAndReplaceWidget.focus();
		}
		return Promise.resolve(null);
	}
}

// --- Toggle Search On Type

export class ToggleSearchOnTypeAction extends Action {

	static readonly ID = 'workbench.action.toggleSearchOnType';
	static readonly LABEL = nls.localize('toggleTabs', "Toggle Search on Type");

	private static readonly searchOnTypeKey = 'search.searchOnType';

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		const searchOnType = this.configurationService.getValue<boolean>(ToggleSearchOnTypeAction.searchOnTypeKey);
		return this.configurationService.updateValue(ToggleSearchOnTypeAction.searchOnTypeKey, !searchOnType);
	}
}

export function expandAll(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		const viewer = searchView.getControl();
		viewer.expandAll();
	}
}

export function clearSearchResults(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	searchView?.clearSearchResults();
}

export function cancelSearch(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	searchView?.cancelSearch();
}

export function refreshSearch(accessor: ServicesAccessor) {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	searchView?.triggerQueryChange({ preserveFocus: false });
}

export function collapseDeepestExpandedLevel(accessor: ServicesAccessor) {

	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	if (searchView) {
		const viewer = searchView.getControl();

		/**
		 * one level to collapse so collapse everything. If FolderMatch, check if there are visible grandchildren,
		 * i.e. if Matches are returned by the navigator, and if so, collapse to them, otherwise collapse all levels.
		 */
		const navigator = viewer.navigate();
		let node = navigator.first();
		let canCollapseFileMatchLevel = false;
		let canCollapseFirstLevel = false;

		if (node instanceof FolderMatch) {
			while (node = navigator.next()) {
				if (node instanceof Match) {
					canCollapseFileMatchLevel = true;
					break;
				}
				if (searchView.isTreeLayoutViewVisible && !canCollapseFirstLevel) {
					const immediateParent = node.parent();
					if (immediateParent instanceof FolderMatchWorkspaceRoot || immediateParent instanceof FolderMatchNoRoot) {
						canCollapseFirstLevel = true;
					}
				}
			}
		}

		if (canCollapseFileMatchLevel) {
			node = navigator.first();
			do {
				if (node instanceof FileMatch) {
					viewer.collapse(node);
				}
			} while (node = navigator.next());
		} else if (canCollapseFirstLevel) {
			node = navigator.first();
			if (node) {
				do {
					const immediateParent = node.parent();
					if (immediateParent instanceof FolderMatchWorkspaceRoot || immediateParent instanceof FolderMatchNoRoot) {
						if (viewer.hasElement(immediateParent) && viewer.isCollapsed(immediateParent)) {
							viewer.collapse(immediateParent, true);
						} else {
							viewer.collapseAll();
						}
					}
				} while (node = navigator.next());
			}
		} else {
			viewer.collapseAll();
		}

		const firstFocusParent = viewer.getFocus()[0]?.parent();

		if (firstFocusParent && (firstFocusParent instanceof FolderMatch || firstFocusParent instanceof FileMatch) &&
			viewer.hasElement(firstFocusParent) && viewer.isCollapsed(firstFocusParent)) {
			viewer.domFocus();
			viewer.focusFirst();
			viewer.setSelection(viewer.getFocus());
		}
	}
}

export class FocusNextSearchResultAction extends Action {
	static readonly ID = 'search.action.focusNextSearchResult';
	static readonly LABEL = nls.localize('FocusNextSearchResult.label', "Focus Next Search Result");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			return (this.editorService.activeEditorPane as SearchEditor).focusNextResult();
		}

		return openSearchView(this.viewsService).then(searchView => {
			searchView?.selectNextMatch();
		});
	}
}

export class FocusPreviousSearchResultAction extends Action {
	static readonly ID = 'search.action.focusPreviousSearchResult';
	static readonly LABEL = nls.localize('FocusPreviousSearchResult.label', "Focus Previous Search Result");

	constructor(id: string, label: string,
		@IViewsService private readonly viewsService: IViewsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(id, label);
	}

	override async run(): Promise<any> {
		const input = this.editorService.activeEditor;
		if (input instanceof SearchEditorInput) {
			// cast as we cannot import SearchEditor as a value b/c cyclic dependency.
			return (this.editorService.activeEditorPane as SearchEditor).focusPreviousResult();
		}

		return openSearchView(this.viewsService).then(searchView => {
			searchView?.selectPreviousMatch();
		});
	}
}

export abstract class AbstractSearchAndReplaceAction extends Action {

	/**
	 * Returns element to focus after removing the given element
	 */
	getElementToFocusAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, elementToRemove: RenderableMatch, isTreeViewVisible: boolean): RenderableMatch {
		const elementToFocus = this.getNextElementAfterRemoved(viewer, elementToRemove);
		return elementToFocus || this.getPreviousElementAfterRemoved(viewer, elementToRemove, isTreeViewVisible);
	}

	getNextElementAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, element: RenderableMatch): RenderableMatch {
		const navigator: ITreeNavigator<any> = viewer.navigate(element);
		if (element instanceof FolderMatch) {
			while (!!navigator.next() && !(navigator.current() instanceof FolderMatch)) { }
		} else if (element instanceof FileMatch) {
			while (!!navigator.next() && !(navigator.current() instanceof FileMatch)) { }
		} else {
			while (navigator.next() && !(navigator.current() instanceof Match)) {
				viewer.expand(navigator.current());
			}
		}
		return navigator.current();
	}

	getPreviousElementAfterRemoved(viewer: WorkbenchObjectTree<RenderableMatch>, element: RenderableMatch, isTreeViewVisible: boolean): RenderableMatch {
		const navigator: ITreeNavigator<any> = viewer.navigate(element);
		let previousElement = navigator.previous();
		// Hence take the previous element.
		const parent = getVisibleParent(element, isTreeViewVisible);
		if (parent === previousElement) {
			previousElement = navigator.previous();
		}

		if (parent instanceof FileMatch && getVisibleParent(parent, isTreeViewVisible) === previousElement) {
			previousElement = navigator.previous();
		}

		// If the previous element is a File or Folder, expand it and go to its last child.
		// Spell out the two cases, would be too easy to create an infinite loop, like by adding another level...
		if (element instanceof Match && previousElement && previousElement instanceof FolderMatch) {
			navigator.next();
			viewer.expand(previousElement);
			previousElement = navigator.previous();
		}

		if (element instanceof Match && previousElement && previousElement instanceof FileMatch) {
			navigator.next();
			viewer.expand(previousElement);
			previousElement = navigator.previous();
		}

		return previousElement;
	}
}

class ReplaceActionRunner {
	constructor(
		private viewer: WorkbenchObjectTree<RenderableMatch>,
		private viewlet: SearchView | undefined,
		private getElementToFocusAfterRemoved: (viewer: WorkbenchObjectTree<RenderableMatch>, lastElementToBeRemoved: RenderableMatch, isTreeViewVisible: boolean) => RenderableMatch,
		private getPreviousElementAfterRemoved: (viewer: WorkbenchObjectTree<RenderableMatch>, element: RenderableMatch, isTreeViewVisible: boolean) => RenderableMatch,
		// Services
		@IReplaceService private readonly replaceService: IReplaceService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IViewsService private readonly viewsService: IViewsService
	) { }

	async performReplace(element: FolderMatch | FileMatch | Match): Promise<any> {
		// since multiple elements can be selected, we need to check the type of the FolderMatch/FileMatch/Match before we perform the replace.
		const opInfo = getElementsToOperateOnInfo(this.viewer, element, this.configurationService.getValue<ISearchConfigurationProperties>('search'));
		const elementsToReplace = opInfo.elements;

		const searchView = getSearchView(this.viewsService);
		const searchResult = searchView?.searchResult;

		if (searchResult) {
			searchResult.batchReplace(elementsToReplace);
		}

		const currentBottomFocusElement = elementsToReplace[elementsToReplace.length - 1];

		if (currentBottomFocusElement instanceof Match) {
			const elementToFocus = this.getElementToFocusAfterReplace(currentBottomFocusElement);

			if (elementToFocus) {
				this.viewer.setFocus([elementToFocus], getSelectionKeyboardEvent());
				this.viewer.setSelection([elementToFocus], getSelectionKeyboardEvent());
			}
			const elementToShowReplacePreview = this.getElementToShowReplacePreview(elementToFocus, currentBottomFocusElement, searchView?.isTreeLayoutViewVisible ?? false);

			this.viewer.domFocus();

			const useReplacePreview = this.configurationService.getValue<ISearchConfiguration>().search.useReplacePreview;
			if (!useReplacePreview || !elementToShowReplacePreview || this.hasToOpenFile(currentBottomFocusElement)) {
				this.viewlet?.open(currentBottomFocusElement, true);
			} else {
				this.replaceService.openReplacePreview(elementToShowReplacePreview, true);
			}
			return;
		} else {
			const nextFocusElement = this.getElementToFocusAfterRemoved(this.viewer, currentBottomFocusElement, searchView?.isTreeLayoutViewVisible ?? false);

			if (nextFocusElement) {
				this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
				this.viewer.setSelection([nextFocusElement], getSelectionKeyboardEvent());
			}

			this.viewer.domFocus();

			if (element instanceof FileMatch) {
				this.viewlet?.open(element, true);
			}

			return;
		}
	}

	private getElementToFocusAfterReplace(currElement: Match): RenderableMatch {
		const navigator: ITreeNavigator<RenderableMatch | null> = this.viewer.navigate();
		let fileMatched = false;
		let elementToFocus: RenderableMatch | null = null;
		do {
			elementToFocus = navigator.current();
			if (elementToFocus instanceof Match) {
				if (elementToFocus.parent().id() === currElement.parent().id()) {
					fileMatched = true;
					if (currElement.range().getStartPosition().isBeforeOrEqual(elementToFocus.range().getStartPosition())) {
						// Closest next match in the same file
						break;
					}
				} else if (fileMatched) {
					// First match in the next file (if expanded)
					break;
				}
			} else if (fileMatched) {
				if (this.viewer.isCollapsed(elementToFocus)) {
					// Next file match (if collapsed)
					break;
				}
			}
		} while (!!navigator.next());
		return elementToFocus!;
	}

	private getElementToShowReplacePreview(elementToFocus: RenderableMatch, currBottomElem: RenderableMatch, isTreeViewVisible: boolean): Match | null {
		if (this.hasSameParent(elementToFocus, currBottomElem)) {
			return <Match>elementToFocus;
		}
		const previousElement = this.getPreviousElementAfterRemoved(this.viewer, elementToFocus, isTreeViewVisible);
		if (this.hasSameParent(previousElement, currBottomElem)) {
			return <Match>previousElement;
		}
		return null;
	}

	private hasSameParent(element: RenderableMatch, currBottomElem: RenderableMatch): boolean {
		if (!(currBottomElem instanceof Match)) {
			return false;
		}
		return element && element instanceof Match && this.uriIdentityService.extUri.isEqual(element.parent().resource, currBottomElem.parent().resource);
	}

	private hasToOpenFile(currBottomElem: RenderableMatch): boolean {
		if (!(currBottomElem instanceof Match)) {
			return false;
		}
		const activeEditor = this.editorService.activeEditor;
		const file = activeEditor?.resource;
		if (file) {
			return this.uriIdentityService.extUri.isEqual(file, currBottomElem.parent().resource);
		}
		return false;
	}
}

export class RemoveAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('RemoveAction.label', "Dismiss");

	constructor(
		private viewer: WorkbenchObjectTree<RenderableMatch>,
		private element: RenderableMatch,
		@IKeybindingService keyBindingService: IKeybindingService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IViewsService private readonly viewsService: IViewsService,
	) {
		super(Constants.RemoveActionId, appendKeyBindingLabel(RemoveAction.LABEL, keyBindingService.lookupKeybinding(Constants.RemoveActionId), keyBindingService), ThemeIcon.asClassName(searchRemoveIcon));
	}

	override async run(): Promise<any> {
		const opInfo = getElementsToOperateOnInfo(this.viewer, this.element, this.configurationService.getValue<ISearchConfigurationProperties>('search'));
		const elementsToRemove = opInfo.elements;
		const searchView = getSearchView(this.viewsService);
		if (elementsToRemove.length === 0) {
			return;
		}

		if (opInfo.mustReselect) {
			for (const currentElement of elementsToRemove) {
				const nextFocusElement = !currentElement || currentElement instanceof SearchResult || arrayContainsElementOrParent(currentElement, elementsToRemove) ?
					this.getElementToFocusAfterRemoved(this.viewer, currentElement, searchView?.isTreeLayoutViewVisible ?? false) :
					null;
				if (nextFocusElement && !arrayContainsElementOrParent(nextFocusElement, elementsToRemove)) {
					this.viewer.reveal(nextFocusElement);
					this.viewer.setFocus([nextFocusElement], getSelectionKeyboardEvent());
					this.viewer.setSelection([nextFocusElement], getSelectionKeyboardEvent());
					break;
				}
			}
		}

		const searchResult = searchView?.searchResult;

		if (searchResult) {
			searchResult.batchRemove(elementsToRemove);
		}

		this.viewer.domFocus();
		return;
	}
}


export class ReplaceAllAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('file.replaceAll.label', "Replace All");
	private replaceRunner: ReplaceActionRunner;
	constructor(
		viewlet: SearchView,
		private fileMatch: FileMatch,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService keyBindingService: IKeybindingService,
	) {
		super(Constants.ReplaceAllInFileActionId, appendKeyBindingLabel(ReplaceAllAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFileActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceAllIcon));
		this.replaceRunner = this.instantiationService.createInstance(ReplaceActionRunner, viewlet.getControl(), viewlet, this.getElementToFocusAfterRemoved, this.getPreviousElementAfterRemoved);
	}

	override async run(): Promise<any> {
		return this.replaceRunner.performReplace(this.fileMatch);
	}
}

export class ReplaceAllInFolderAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('file.replaceAll.label', "Replace All");
	private replaceRunner: ReplaceActionRunner;

	constructor(viewer: WorkbenchObjectTree<RenderableMatch>, private folderMatch: FolderMatch,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService keyBindingService: IKeybindingService
	) {
		super(Constants.ReplaceAllInFolderActionId, appendKeyBindingLabel(ReplaceAllInFolderAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceAllInFolderActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceAllIcon));
		this.replaceRunner = this.instantiationService.createInstance(ReplaceActionRunner, viewer, undefined, this.getElementToFocusAfterRemoved, this.getPreviousElementAfterRemoved);
	}

	override run(): Promise<any> {
		return this.replaceRunner.performReplace(this.folderMatch);
	}
}

export class ReplaceAction extends AbstractSearchAndReplaceAction {

	static readonly LABEL = nls.localize('match.replace.label', "Replace");

	static runQ = Promise.resolve();
	private replaceRunner: ReplaceActionRunner;

	constructor(viewer: WorkbenchObjectTree<RenderableMatch>, private element: Match, viewlet: SearchView,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IKeybindingService keyBindingService: IKeybindingService,
	) {
		super(Constants.ReplaceActionId, appendKeyBindingLabel(ReplaceAction.LABEL, keyBindingService.lookupKeybinding(Constants.ReplaceActionId), keyBindingService), ThemeIcon.asClassName(searchReplaceIcon));
		this.replaceRunner = this.instantiationService.createInstance(ReplaceActionRunner, viewer, viewlet, this.getElementToFocusAfterRemoved, this.getPreviousElementAfterRemoved);
	}

	override async run(): Promise<any> {
		return this.replaceRunner.performReplace(this.element);
	}
}

export const copyPathCommand: ICommandHandler = async (accessor, fileMatch: FileMatch | FolderMatchWithResource | undefined) => {
	if (!fileMatch) {
		const selection = getSelectedRow(accessor);
		if (!(selection instanceof FileMatch || selection instanceof FolderMatchWithResource)) {
			return;
		}

		fileMatch = selection;
	}

	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	const text = labelService.getUriLabel(fileMatch.resource, { noPrefix: true });
	await clipboardService.writeText(text);
};

function matchToString(match: Match, indent = 0): string {
	const getFirstLinePrefix = () => `${match.range().startLineNumber},${match.range().startColumn}`;
	const getOtherLinePrefix = (i: number) => match.range().startLineNumber + i + '';

	const fullMatchLines = match.fullPreviewLines();
	const largestPrefixSize = fullMatchLines.reduce((largest, _, i) => {
		const thisSize = i === 0 ?
			getFirstLinePrefix().length :
			getOtherLinePrefix(i).length;

		return Math.max(thisSize, largest);
	}, 0);

	const formattedLines = fullMatchLines
		.map((line, i) => {
			const prefix = i === 0 ?
				getFirstLinePrefix() :
				getOtherLinePrefix(i);

			const paddingStr = ' '.repeat(largestPrefixSize - prefix.length);
			const indentStr = ' '.repeat(indent);
			return `${indentStr}${prefix}: ${paddingStr}${line}`;
		});

	return formattedLines.join('\n');
}
function fileFolderMatchToString(match: FileMatch | FolderMatch | FolderMatchWithResource, labelService: ILabelService): { text: string; count: number } {
	if (match instanceof FileMatch) {
		return fileMatchToString(match, labelService);
	} else {
		return folderMatchToString(match, labelService);
	}
}
const lineDelimiter = isWindows ? '\r\n' : '\n';
function fileMatchToString(fileMatch: FileMatch, labelService: ILabelService): { text: string; count: number } {
	const matchTextRows = fileMatch.matches()
		.sort(searchMatchComparer)
		.map(match => matchToString(match, 2));
	const uriString = labelService.getUriLabel(fileMatch.resource, { noPrefix: true });
	return {
		text: `${uriString}${lineDelimiter}${matchTextRows.join(lineDelimiter)}`,
		count: matchTextRows.length
	};
}

function folderMatchToString(folderMatch: FolderMatchWithResource | FolderMatch, labelService: ILabelService): { text: string; count: number } {
	const results: string[] = [];
	let numMatches = 0;

	const matches = folderMatch.matches().sort(searchMatchComparer);

	matches.forEach(match => {
		const result = fileFolderMatchToString(match, labelService);
		numMatches += result.count;
		results.push(result.text);
	});

	return {
		text: results.join(lineDelimiter + lineDelimiter),
		count: numMatches
	};
}

export const copyMatchCommand: ICommandHandler = async (accessor, match: RenderableMatch | undefined) => {
	if (!match) {
		const selection = getSelectedRow(accessor);
		if (!selection) {
			return;
		}

		match = selection;
	}

	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	let text: string | undefined;
	if (match instanceof Match) {
		text = matchToString(match);
	} else if (match instanceof FileMatch) {
		text = fileMatchToString(match, labelService).text;
	} else if (match instanceof FolderMatch) {
		text = folderMatchToString(match, labelService).text;
	}

	if (text) {
		await clipboardService.writeText(text);
	}
};

function allFolderMatchesToString(folderMatches: Array<FolderMatchWithResource | FolderMatch>, labelService: ILabelService): string {
	const folderResults: string[] = [];
	folderMatches = folderMatches.sort(searchMatchComparer);
	for (let i = 0; i < folderMatches.length; i++) {
		const folderResult = folderMatchToString(folderMatches[i], labelService);
		if (folderResult.count) {
			folderResults.push(folderResult.text);
		}
	}

	return folderResults.join(lineDelimiter + lineDelimiter);
}

function getSelectedRow(accessor: ServicesAccessor): RenderableMatch | undefined | null {
	const viewsService = accessor.get(IViewsService);
	const searchView = getSearchView(viewsService);
	return searchView?.getControl().getSelection()[0];
}

export const copyAllCommand: ICommandHandler = async (accessor) => {
	const viewsService = accessor.get(IViewsService);
	const clipboardService = accessor.get(IClipboardService);
	const labelService = accessor.get(ILabelService);

	const searchView = getSearchView(viewsService);
	if (searchView) {
		const root = searchView.searchResult;

		const text = allFolderMatchesToString(root.folderMatches(), labelService);
		await clipboardService.writeText(text);
	}
};

export const clearHistoryCommand: ICommandHandler = accessor => {
	const searchHistoryService = accessor.get(ISearchHistoryService);
	searchHistoryService.clearHistory();
};

export const focusSearchListCommand: ICommandHandler = accessor => {
	const viewsService = accessor.get(IViewsService);
	openSearchView(viewsService).then(searchView => {
		searchView?.moveFocusToResults();
	});
};

function getElementsToOperateOnInfo(viewer: WorkbenchObjectTree<RenderableMatch, void>, currElement: RenderableMatch, sortConfig: ISearchConfigurationProperties): { elements: RenderableMatch[]; mustReselect: boolean } {
	let elements: RenderableMatch[] = viewer.getSelection().filter((x): x is RenderableMatch => x !== null).sort((a, b) => searchComparer(a, b, sortConfig.sortOrder));

	const mustReselect = elements.includes(currElement); // this indicates whether we need to re-focus/re-select on a remove.

	// if selection doesn't include multiple elements, just return current focus element.
	if (!(elements.length > 1 && elements.includes(currElement))) {
		elements = [currElement];
	}

	return { elements, mustReselect };
}

function getVisibleParent(element: RenderableMatch, isTreeViewVisible: boolean): FileMatch | FolderMatch | SearchResult | null {
	return (isTreeViewVisible || element instanceof Match) ? element.parent() : element.closestRoot;
}
