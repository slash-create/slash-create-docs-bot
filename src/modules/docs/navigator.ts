/**
 * Fetch all *.json files
 * https://api.github.com/repos/Snazzah/slash-create/git/trees/docs
 * Filter all paths at .tree.*.path using ".json$"
 * *Includes all valid docfile references even if they aren't publically shown.*
 * Reverse the list, pickout the last 3 major versions (v[4-6].*.*) along with "latest" and "master"
 * *Then filter out which one of those has the later patch in all minor versions.*
 */

import { filter } from "fuzzy";
import { Collection } from "slash-create";

import { TIME } from "&common/constants";
import { FixedInterval } from "&common/fixed-interval";

import {
	type AnyChildDescriptor,
	type AnyDescriptor,
	type DocumentationRoot,
	type GitHubViewMode,
	TypeSymbol,
} from "./types";
import { defineCommon, getSymbol } from "./helpers";
import type VersionAggregator from "./version-aggregator";

export class TypeNavigator {
	static knownSymbols = {
		METHOD: TypeSymbol.Method,
		MEMBER: TypeSymbol.Member,
		EVENT: TypeSymbol.Event,
	};

	readonly aggregator: VersionAggregator;
	knownFiles: string[] = [];
	map: Collection<string, AnyDescriptor> = new Collection();
	// {type} -> {entry} + {get parent?}
	tag: string;

	#deferred = Promise.withResolvers();
	#fetchedAt?: number;
	#interval: FixedInterval;
	#raw?: DocumentationRoot;
	#ready = false;

	get meta() {
		if (!this.#ready) return undefined;
		return this.#raw.meta;
	}

	get ready() {
		return this.#ready;
	}

	get onReady() {
		return this.#deferred.promise;
	}

	constructor(tag: string, aggregator: VersionAggregator) {
		this.tag = tag;
		this.aggregator = aggregator;
		this.#setupInterval();

		// #fetchedAt
	}

	#setupInterval(force = false) {
		if (this.#interval && !force) return;

		this.#interval = new FixedInterval(
			TIME.HOUR / 4,
			0,
			false,
			this.refresh.bind(this),
		);
		this.refresh();
	}

	get #targetURI() {
		return `${this.aggregator.provider.rawDocsURL(void 0, this.aggregator.provider.repo.manifest.branch)}/${this.tag}.json`;
	}

	baseRepoURL(view: GitHubViewMode = "tree") {
		return this.aggregator.provider.webRepoURL(this.tag, view);
	}

	codeFileURL(file: string, lineRange: [number, number?]) {
		const lineString = lineRange
			.filter(Boolean)
			.map((n) => `L${n}`)
			.join("-");

		return `${this.baseRepoURL("blob")}/${file}#${lineString}`;
	}

	rawFileURL(file: string, target: "source" | "manifest" = "source") {
		return `${this.aggregator.provider.rawRepoURL(void 0, this.tag)}/${file}`;
	}

	docsURL(descriptor: AnyDescriptor) {
		return this.aggregator.provider.docsURL(this.tag, descriptor);
	}

	rawDocsURL(species: string, type: string) {
		return this.aggregator.provider.partDocsURL(this.tag, species, type);
	}

	static joinKey(entryPath: string[], connector: string) {
		return entryPath.filter(Boolean).join(connector);
	}

	get<T extends AnyDescriptor>(entity: string): T {
		return this.map.get(entity) as T;
	}

	filterEntity(entityPath: string, limit = 20) {
		if (!this.#ready) return [];

		return filter(entityPath, [...this.map.keys()]).slice(0, limit);
	}

	filterFile(filePath: string, limit = 20) {
		if (!this.#ready) return [];

		return filter(filePath, this.knownFiles).slice(0, limit);
	}
	/*
  find(parentName: string, childName?: string) {
    if (!this.#ready) return;

    for (const connector of Object.values(TypeNavigator.knownSymbols)) {
    const assumedKey = TypeNavigator.joinKey([parentName, childName], connector);

    if (!this.map.has(assumedKey)) continue;
    else return this.map.get(assumedKey);
    }
  }
  */
	async refresh() {
		this.#ready = false;
		this.#deferred = Promise.withResolvers();
		this.map.clear();

		const res = await this.aggregator.provider.fetchGitHubAPI(this.#targetURI);
		this.#raw = await res.json();

		this.#fetchedAt = Date.now();

		for (const classEntry of this.#raw.classes) {
			this.#define("class", classEntry);
		}

		for (const typeEntry of this.#raw.typedefs) {
			this.#define("typedef", typeEntry);
		}

		this.#ready = true;
		this.#deferred.resolve();
	}

	#define<Descriptor extends AnyDescriptor>(
		descriptorType: string,
		descriptor: Descriptor,
	) {
		defineCommon(this, descriptorType, descriptor);

		this.map.set(descriptor.toString(), descriptor);
		if ("path" in descriptor.meta) {
			if (this.aggregator.provider.repo.manifest.folder)
				descriptor.meta.path = descriptor.meta.path.slice(
					this.aggregator.provider.repo.source.folder.length,
				);

			this.#registerKnownFile([descriptor.meta.path, descriptor.meta.file]);
		}

		const pairs = {
			Event: "events",
			Method: "methods",
			Member: "props",
		};

		for (const [species, location] of Object.entries(pairs)) {
			if (location in descriptor) {
				for (const entry of descriptor[location] as AnyChildDescriptor[]) {
					const symbol = getSymbol(species);

					defineCommon(this, species.toLowerCase(), descriptor, entry, symbol);

					this.map.set(entry.toString(), entry);
					if (entry.meta && "path" in entry.meta)
						this.#registerKnownFile([entry.meta.path, entry.meta.file]);
				}
			}
		}
	}

	#registerKnownFile(pathOrMeta: string | string[]) {
		const [filePath] = (
			Array.isArray(pathOrMeta) ? pathOrMeta.join("/") : pathOrMeta
		).split("#");
		if (!filePath.startsWith("src")) return;
		if (!this.knownFiles.includes(filePath)) this.knownFiles.push(filePath);
	}

	[Bun.inspect.custom]() {
		return `<${this.constructor.name} tag="${this.tag}">`;
	}
}
