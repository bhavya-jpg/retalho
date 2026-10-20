"""Results provenance: the commit label in results.json (pipeline/export.py git_commit)."""

import subprocess

import pytest

from pipeline import export


def git(repo, *args):
    subprocess.run(["git", "-c", "user.name=test", "-c", "user.email=test@example.invalid", *args], cwd=repo,
                   check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, "init", "-q")
    (tmp_path / "pipeline").mkdir()
    (tmp_path / "pipeline" / "model.py").write_text("x = 1\n")
    for p in ("out/results.json", "web/public/results.json"):
        (tmp_path / p).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / p).write_text("{}\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def head(repo):
    return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo, capture_output=True, text=True).stdout.strip()


def test_clean_tree_gives_plain_commit(repo):
    assert export.git_commit(repo) == head(repo)


def test_rewritten_pipeline_outputs_do_not_count_as_dirty(repo):
    (repo / "out" / "results.json").write_text('{"new": 1}\n')
    (repo / "web" / "public" / "results-synthetic.json").write_text("{}\n")      # new output file
    assert export.git_commit(repo) == head(repo)


@pytest.mark.parametrize("change", [
    lambda r: (r / "pipeline" / "model.py").write_text("x = 2\n"),             # edited code
    lambda r: (r / "pipeline" / "new_module.py").write_text("y = 1\n"),        # untracked code
    lambda r: (r / "config.yaml").write_text("a: 1\n"),                        # untracked config
])
def test_source_changes_are_dirty(repo, change):
    change(repo)
    assert export.git_commit(repo) == head(repo) + "-dirty"


def test_outside_a_repository(tmp_path):
    assert export.git_commit(tmp_path) == "uncommitted"
