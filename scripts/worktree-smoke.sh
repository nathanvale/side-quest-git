#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

KEEP_TMP="${WORKTREE_SMOKE_KEEP_TMP:-0}"
ARTIFACT_DIR="${WORKTREE_SMOKE_ARTIFACT_DIR:-}"

SUITES=()
if [[ "${1:-}" == "--suite" ]]; then
	if [[ -z "${2:-}" ]]; then
		echo "Usage: $0 [--suite core|events|shallow]"
		exit 1
	fi
	SUITES=("$2")
else
	SUITES=("core" "events" "shallow")
fi

if [[ -n "${SQ_GIT_CLI:-}" ]]; then
	# shellcheck disable=SC2206
	CLI=(${SQ_GIT_CLI})
elif [[ -f "${REPO_ROOT}/dist/worktree/cli/index.js" ]]; then
	CLI=(bun "${REPO_ROOT}/dist/worktree/cli/index.js")
elif [[ -f "${REPO_ROOT}/dist/worktree/cli.js" ]]; then
	CLI=(bun "${REPO_ROOT}/dist/worktree/cli.js")
else
	CLI=(bun "${REPO_ROOT}/src/worktree/cli/index.ts")
fi

for bin in git bun jq curl; do
	if ! command -v "${bin}" >/dev/null 2>&1; then
		echo "Missing required binary: ${bin}"
		exit 1
	fi
done

PASS_COUNT=0
TMP_DIRS=()
BG_PIDS=()

new_tmp_dir() {
	local prefix="$1"
	local dir
	dir="$(mktemp -d "/tmp/sq-git-${prefix}.XXXXXX")"
	TMP_DIRS+=("${dir}")
	echo "${dir}"
}

record_pass() {
	local msg="$1"
	PASS_COUNT=$((PASS_COUNT + 1))
	echo "PASS: ${msg}"
}

assert_jq() {
	local name="$1"
	local json="$2"
	local expr="$3"
	if echo "${json}" | jq -e "if (type == \"object\" and .status? == \"ok\" and has(\"data\")) then (.data | (${expr})) else (${expr}) end" >/dev/null 2>&1; then
		record_pass "${name}"
	else
		echo "FAIL: ${name}"
		echo "jq expression: ${expr}"
		echo "payload:"
		echo "${json}"
		exit 1
	fi
}

copy_artifacts() {
	if [[ -z "${ARTIFACT_DIR}" ]]; then
		return
	fi
	mkdir -p "${ARTIFACT_DIR}"
	for dir in "${TMP_DIRS[@]}"; do
		cp -R "${dir}" "${ARTIFACT_DIR}/"
	done
}

cleanup() {
	local status=$?
	set +e
	for pid in "${BG_PIDS[@]}"; do
		kill "${pid}" >/dev/null 2>&1 || true
		wait "${pid}" >/dev/null 2>&1 || true
	done
	copy_artifacts || true
	if [[ "${KEEP_TMP}" != "1" ]]; then
		for dir in "${TMP_DIRS[@]}"; do
			rm -rf "${dir}" || true
		done
	fi
	exit "${status}"
}
trap cleanup EXIT

setup_git_repo() {
	local repo="$1"
	local remote="$2"

	git init -b main "${repo}" >/dev/null
	git init --bare "${remote}" >/dev/null
	(
		cd "${repo}"
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		git remote add origin "${remote}"

		echo "# Smoke Repo" > README.md
		echo ".env" > .gitignore
		echo "API_TOKEN=abc" > .env
		mkdir -p .claude
		echo "context v1" > .claude/context.md

		git add README.md .gitignore .claude/context.md
		git commit -m "chore: initial" >/dev/null
		git push -u origin main >/dev/null
	)
}

run_core_suite() {
	local tmp_dir repo remote out
	tmp_dir="$(new_tmp_dir "smoke-core")"
	repo="${tmp_dir}/repo"
	remote="${tmp_dir}/remote.git"
	mkdir -p "${repo}"

	setup_git_repo "${repo}" "${remote}"

	pushd "${repo}" >/dev/null

	out="$("${CLI[@]}" worktree init)"
	[[ -f .worktrees.json ]]
	assert_jq "init output shape" "${out}" '.config.directory == ".worktrees"'

	out="$("${CLI[@]}" worktree create feat/alpha --no-install --no-fetch)"
	assert_jq "create feat/alpha output" "${out}" '.branch == "feat/alpha" and .attached == false and (.path | length > 0)'
	[[ -d .worktrees/feat-alpha ]]

	out="$("${CLI[@]}" worktree list --all)"
	assert_jq "list --all includes health" "${out}" '.health.allFailed == false and (.worktrees | length >= 2)'
	assert_jq "list --all includes feat/alpha" "${out}" '.worktrees | any(.branch == "feat/alpha")'

	out="$("${CLI[@]}" worktree check feat/alpha)"
	assert_jq "check clean" "${out}" '.exists == true and .dirty == false and .status == "pristine"'

	echo "dirty change" >> .worktrees/feat-alpha/README.md
	out="$("${CLI[@]}" worktree check feat/alpha)"
	assert_jq "check dirty" "${out}" '.exists == true and .dirty == true'

	echo "API_TOKEN=xyz" > .env
	echo "context v2" > .claude/context.md
	out="$("${CLI[@]}" worktree sync feat/alpha --dry-run)"
	assert_jq "sync dry-run reports changes" "${out}" '.dryRun == true and .filesCopied >= 1'
	out="$("${CLI[@]}" worktree sync feat/alpha)"
	assert_jq "sync real copies files" "${out}" '.dryRun == false and .filesCopied >= 1'

	grep -q "API_TOKEN=xyz" .worktrees/feat-alpha/.env

	out="$("${CLI[@]}" worktree status)"
	assert_jq "status output shape" "${out}" 'type == "array" and (length >= 2) and any(.branch == "feat/alpha")'

	(
		cd .worktrees/feat-alpha
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		echo "alpha tracked" > feature-alpha.txt
		git add README.md feature-alpha.txt
		git commit -m "feat: alpha changes" >/dev/null
	)

	out="$("${CLI[@]}" worktree status)"
	assert_jq "status sees alpha branch" "${out}" 'any(.branch == "feat/alpha")'

	git merge --no-ff -m "Merge feat/alpha" feat/alpha >/dev/null
	out="$("${CLI[@]}" worktree list --all)"
	assert_jq "ancestor merge detected" "${out}" '.worktrees | any(.branch == "feat/alpha" and .merged == true and .mergeMethod == "ancestor")'

	out="$("${CLI[@]}" worktree create feat/squash --no-install --no-fetch)"
	assert_jq "create feat/squash" "${out}" '.branch == "feat/squash"'

	echo "squash file" > .worktrees/feat-squash/squash.txt
	(
		cd .worktrees/feat-squash
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		git add squash.txt
		git commit -m "feat: squash candidate" >/dev/null
	)

	git merge --squash feat/squash >/dev/null
	git commit -m "chore: squash merge feat/squash" >/dev/null
	out="$("${CLI[@]}" worktree list --all)"
	assert_jq "squash merge detected" "${out}" '.worktrees | any(.branch == "feat/squash" and .merged == true and .mergeMethod == "squash")'

	out="$("${CLI[@]}" worktree clean --dry-run)"
	assert_jq "clean dry-run shape" "${out}" '.dryRun == true and (.deleted | type == "array") and (.skipped | type == "array")'
	out="$("${CLI[@]}" worktree clean)"
	assert_jq "clean real executed" "${out}" '.dryRun == false and (.deleted | type == "array")'

	out="$("${CLI[@]}" worktree create feat/recover --no-install --no-fetch)"
	assert_jq "create feat/recover" "${out}" '.branch == "feat/recover"'

	echo "recover me" > .worktrees/feat-recover/recover.txt
	(
		cd .worktrees/feat-recover
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		git add recover.txt
		git commit -m "feat: recover branch commit" >/dev/null
	)

	out="$("${CLI[@]}" worktree delete feat/recover --force --delete-branch)"
	assert_jq "delete recover with branch delete" "${out}" '.branch == "feat/recover" and .branchDeleted == true'
	if git show-ref --verify --quiet refs/heads/feat/recover; then
		echo "FAIL: feat/recover branch should be deleted"
		exit 1
	fi
	record_pass "feat/recover branch deleted"

	out="$("${CLI[@]}" worktree recover)"
	assert_jq "recover list contains feat/recover backup" "${out}" 'type == "array" and any(.branch == "feat/recover")'
	out="$("${CLI[@]}" worktree recover feat/recover)"
	assert_jq "recover restores branch" "${out}" '.restored == "feat/recover"'
	git show-ref --verify --quiet refs/heads/feat/recover
	record_pass "feat/recover branch restored in refs/heads"

	out="$("${CLI[@]}" worktree orphans)"
	assert_jq "orphans output includes health" "${out}" '.health.allFailed == false and (.orphans | type == "array")'
	assert_jq "orphans includes feat/recover" "${out}" '.orphans | any(.branch == "feat/recover")'

	out="$("${CLI[@]}" worktree list --include-orphans)"
	assert_jq "list --include-orphans shape" "${out}" '.worktrees and .orphans and .health and .orphanHealth'

	out="$("${CLI[@]}" worktree create feat/upstream-gone --no-install --no-fetch)"
	assert_jq "create feat/upstream-gone" "${out}" '.branch == "feat/upstream-gone"'

	echo "upstream gone" > .worktrees/feat-upstream-gone/upstream.txt
	(
		cd .worktrees/feat-upstream-gone
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		git add upstream.txt
		git commit -m "feat: upstream branch" >/dev/null
		git push -u origin feat/upstream-gone >/dev/null
	)
	git push origin --delete feat/upstream-gone >/dev/null

	out="$("${CLI[@]}" worktree list --all)"
	assert_jq "upstreamGone=true detected" "${out}" '.worktrees | any(.branch == "feat/upstream-gone" and .upstreamGone == true)'

	out="$(SIDE_QUEST_NO_DETECTION=1 "${CLI[@]}" worktree list --all)"
	assert_jq "kill switch sets detection disabled" "${out}" '.worktrees | map(select(.isMain != true)) | all(.detectionError == "detection disabled")'

	out="$("${CLI[@]}" worktree list --all --timeout 25)"
	assert_jq "--timeout accepted" "${out}" '.worktrees and .health'
	out="$("${CLI[@]}" worktree list --all --shallow-ok)"
	assert_jq "--shallow-ok accepted" "${out}" '.worktrees and .health'

	out="$("${CLI[@]}" worktree clean --include-orphans --delete-branches --force)"
	assert_jq "clean full shape" "${out}" '.deleted and .skipped and .orphansDeleted and .forced == true'

	out="$("${CLI[@]}" worktree recover --cleanup --max-age 1)"
	assert_jq "recover cleanup output" "${out}" '.cleaned and .count >= 0'

	popd >/dev/null
}

run_events_suite() {
	local tmp_dir repo port server_pid out
	tmp_dir="$(new_tmp_dir "smoke-events")"
	repo="${tmp_dir}/repo"
	mkdir -p "${repo}"

	git init -b main "${repo}" >/dev/null
	pushd "${repo}" >/dev/null
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		echo "# events smoke" > README.md
		git add README.md
		git commit -m "init" >/dev/null

		port="$(( (RANDOM % 2000) + 18000 ))"
		"${CLI[@]}" events start --port "${port}" >"${tmp_dir}/server.out" 2>"${tmp_dir}/server.err" &
		server_pid=$!
		BG_PIDS+=("${server_pid}")

		for _ in $(seq 1 40); do
			if curl -fsS "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
				break
			fi
			if ! kill -0 "${server_pid}" 2>/dev/null; then
				echo "FAIL: events server exited early"
				cat "${tmp_dir}/server.err" 2>/dev/null || true
				exit 1
			fi
			sleep 0.1
		done
		curl -fsS "http://127.0.0.1:${port}/health" >/dev/null

		"${CLI[@]}" worktree init >/dev/null
		"${CLI[@]}" worktree create feat/events --no-install --no-fetch >/dev/null

		sleep 0.2
		out="$(curl -fsS "http://127.0.0.1:${port}/events")"
		assert_jq "events server receives worktree lifecycle event" "${out}" 'type == "array" and length >= 1 and any(.type == "worktree.created" or .type == "worktree.attached")'

		kill "${server_pid}" >/dev/null 2>&1 || true
		wait "${server_pid}" >/dev/null 2>&1 || true
		BG_PIDS=()
	popd >/dev/null
}

run_shallow_suite() {
	local tmp_dir src remote clone out
	tmp_dir="$(new_tmp_dir "smoke-shallow")"
	src="${tmp_dir}/src"
	remote="${tmp_dir}/remote.git"
	clone="${tmp_dir}/clone"

	mkdir -p "${src}"
	git init -b main "${src}" >/dev/null
	(
		cd "${src}"
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		echo "line1" > file.txt
		git add file.txt
		git commit -m "c1" >/dev/null
		echo "line2" >> file.txt
		git add file.txt
		git commit -m "c2" >/dev/null
		git init --bare -b main "${remote}" >/dev/null
		git remote add origin "${remote}"
		git push -u origin main >/dev/null
	)
	git clone --depth 1 "file://${remote}" "${clone}" >/dev/null
	pushd "${clone}" >/dev/null
		git config user.name "Smoke Tester"
		git config user.email "smoke@example.com"
		"${CLI[@]}" worktree init >/dev/null
		"${CLI[@]}" worktree create feat/shallow --no-install --no-fetch >/dev/null
		out="$("${CLI[@]}" worktree list --all)"
		assert_jq "shallow clone surfaces SHALLOW_CLONE detectionError" "${out}" '.worktrees | any(.branch == "feat/shallow" and (.detectionError != null) and ((.detectionError | ascii_downcase) | contains("shallow")))'
		assert_jq "shallow clone surfaces SHALLOW_CLONE issue code" "${out}" '.worktrees | any(.branch == "feat/shallow" and (.issues // [] | any(.code == "SHALLOW_CLONE")))'
	popd >/dev/null
}

echo "Using CLI: ${CLI[*]}"
for suite in "${SUITES[@]}"; do
	case "${suite}" in
		core)
			echo "Running suite: core"
			run_core_suite
			;;
		events)
			echo "Running suite: events"
			run_events_suite
			;;
		shallow)
			echo "Running suite: shallow"
			run_shallow_suite
			;;
		*)
			echo "Unknown suite: ${suite}"
			exit 1
			;;
	esac
done

echo "Worktree smoke tests passed (${PASS_COUNT} assertions)"
