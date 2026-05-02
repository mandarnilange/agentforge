#!/usr/bin/env node
// Validates skill SKILL.md frontmatter under `skills/`.
//
// Vercel skills format: name, description, license. Optional `metadata`
// (we accept it but only require version when present).
//
// House rules:
//   - skill folder name must equal frontmatter `name`
//   - skill name must start with PREFIX (default: agentforge-)

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = join(ROOT, "skills");
const PREFIX = process.env.SKILL_PREFIX ?? "agentforge-";

const errors = [];
const err = (msg) => errors.push(msg);

function parseFrontmatter(md, filePath) {
	if (!md.startsWith("---\n")) {
		err(`${filePath}: missing YAML frontmatter (must start with '---')`);
		return null;
	}
	const end = md.indexOf("\n---", 4);
	if (end === -1) {
		err(`${filePath}: unterminated frontmatter (no closing '---')`);
		return null;
	}
	const block = md.slice(4, end);
	const out = {};
	let currentKey = null;
	let currentObj = null;
	for (const rawLine of block.split("\n")) {
		const line = rawLine.replace(/\s+$/, "");
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const indented = /^\s/.test(line);
		const m = line.match(/^(\s*)([\w-]+):\s*(.*)$/);
		if (!m) {
			if (currentKey === "description" && indented) {
				out.description = `${out.description ?? ""} ${line.trim()}`.trim();
			}
			continue;
		}
		const [, indent, key, value] = m;
		if (indent === "") {
			currentKey = key;
			currentObj = null;
			if (value === "" || value === ">") {
				out[key] = key === "metadata" ? {} : "";
				if (key === "metadata") currentObj = out[key];
			} else {
				out[key] = stripQuotes(value);
			}
		} else if (currentObj && currentKey === "metadata") {
			currentObj[key] = stripQuotes(value);
		} else if (currentKey === "description") {
			out.description = `${out.description ?? ""} ${line.trim()}`.replace(/\s+/g, " ").trim();
		}
	}
	return out;
}

function stripQuotes(v) {
	const t = v.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
		return t.slice(1, -1);
	}
	return t;
}

function listSkills() {
	if (!existsSync(SKILLS)) return [];
	return readdirSync(SKILLS).filter((entry) => {
		const full = join(SKILLS, entry);
		return statSync(full).isDirectory() && !entry.startsWith(".");
	});
}

function validateSkill(skillName) {
	const skillDir = join(SKILLS, skillName);
	const skillMd = join(skillDir, "SKILL.md");
	if (!existsSync(skillMd)) {
		err(`${skillName}: missing SKILL.md`);
		return null;
	}
	const md = readFileSync(skillMd, "utf8");
	const fm = parseFrontmatter(md, relative(ROOT, skillMd));
	if (!fm) return null;

	for (const k of ["name", "description", "license"]) {
		if (!fm[k]) err(`${skillName}: frontmatter missing '${k}'`);
	}
	if (!fm.metadata || typeof fm.metadata !== "object") {
		err(`${skillName}: frontmatter missing 'metadata' object`);
	} else {
		if (!fm.metadata.author) err(`${skillName}: 'metadata.author' missing`);
		if (!fm.metadata.version) err(`${skillName}: 'metadata.version' missing`);
	}
	if (fm.name && fm.name !== skillName) {
		err(`${skillName}: folder name does not match frontmatter name '${fm.name}'`);
	}
	if (fm.name && !fm.name.startsWith(PREFIX)) {
		err(`${skillName}: name '${fm.name}' must start with '${PREFIX}'`);
	}
	return fm;
}

const skills = listSkills();
if (skills.length === 0) {
	console.log(`No skills found in ${relative(ROOT, SKILLS)}/`);
	process.exit(0);
}

console.log(`Found ${skills.length} skill(s) in ${relative(ROOT, SKILLS)}/:`);
for (const name of skills) {
	const fm = validateSkill(name);
	const tag = fm?.metadata?.version ? ` (${fm.metadata.version})` : "";
	console.log(`  - ${name}${tag}`);
}

if (errors.length > 0) {
	console.error(`\n✗ ${errors.length} error(s):`);
	for (const e of errors) console.error(`  - ${e}`);
	process.exit(1);
}
console.log("\n✓ skills OK");
