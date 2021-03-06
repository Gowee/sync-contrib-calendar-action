import path from "path"
import * as core from "@actions/core"
import * as io from "@actions/io"
import { exec } from "@actions/exec"
import assert from "assert"

export class GitController {
  private inited = false
  private repoPath: string
  private gitPath?: string

  constructor(repoPath: string) {
    this.repoPath = repoPath
  }

  static async createAsync(repoPath: string, allowingNotInited = false): Promise<GitController> {
    const controller = new GitController(repoPath)
    core.debug("Repo path: " + repoPath)
    await controller.prepare(allowingNotInited)
    return controller
  }

  async prepare(allowingNotInited = false): Promise<void> {
    this.gitPath = await io.which("git", true)
    core.debug("Git path: " + this.gitPath)
    let isGitRoot = true
    try {
      isGitRoot = await this.isTopLevel()
      this.inited = true
    } catch (e) {
      if (!allowingNotInited) {
        throw e
      }
    }
    if (!isGitRoot) {
      throw Error(`${this.repoPath} is not a root of a git repository`)
    }
    core.debug(`Inited: ${this.inited}`)
  }

  async configUser(name?: string, email?: string): Promise<void> {
    assert(this.gitPath)
    if (name !== undefined) {
      await this.exec(["config", "user.name", name])
    }
    if (email !== undefined) {
      await this.exec(["config", "user.email", email])
    }
  }

  async init(): Promise<void> {
    assert(this.gitPath)
    await this.exec(["init"])
  }

  private async isTopLevel(): Promise<boolean> {
    const topLevel = await this.getTopLevel()
    core.debug("Repo toplevel: " + path.resolve(topLevel))
    return path.resolve(topLevel) === path.resolve(this.repoPath)
  }

  private async getTopLevel(): Promise<string> {
    const raw = await this.exec(["rev-parse", "--show-toplevel"])
    return raw.trim()
  }

  async getLastAuthorDate(filters?: {
    author?: string
    committer?: string
    message?: string
  }): Promise<Date> {
    assert(this.inited)
    const filterArgs = []
    if (filters?.author !== undefined) {
      filterArgs.push("--author", `${filters.author}`)
    }
    if (filters?.committer !== undefined) {
      filterArgs.push("--committer", `${filters.committer}`)
    }
    if (filters?.message !== undefined) {
      filterArgs.push("--grep", `${filters.message}`)
    }

    const rlArgs = ["rev-list", "--count", "HEAD"]
    if (parseInt((await this.exec(rlArgs.concat(filterArgs))).trim(), 10) === 0) {
      return new Date(-1)
    } else {
      const logArgs = ["log", "-1", "--format=%at"] // %ct for commit time, %at for author time
      return new Date(parseInt((await this.exec(logArgs.concat(filterArgs))).trim(), 10) * 1000)
    }
    // FOR being used as lastSyned:
    //  If using COMMIT_DATE,
    //   As most sources (e.g. GitLab) have no accurate dates other than day-by-day calendar, there
    //   is no way to distinguish activities in one day from each other. A little trick is to add I
    //   seconds to the date of the I-th activity in a day (e.g. gitlab.ts #L41). With COMMIT_DATE
    //   used as lastSynced, newly added activities within a day after the run of the action in
    //   that day would be ignored forever. (Or use the last second of that day?)
    //  If using AUTHOR_DATE,
    //   The calendar from sources SHOULD be sorted before committing as the raw data of some
    //   sources are not in order. If they are not ordered, the action may repeatedly commits some
    //   previously committed activities.
  }

  async commit(
    message: string,
    allowingEmpty = false,
    env: { [key: string]: string }
  ): Promise<void> {
    assert(this.inited)
    const args = ["commit", "-m", `${message}`]
    if (allowingEmpty) {
      args.push("--allow-empty")
    }

    // TODO: abstract GIT_{COMMITTER,AUTHOR}_{NAME,EMAIL,DATE} into options in params
    await this.exec(args, env)
  }

  async push(): Promise<void> {
    assert(this.inited)
    await this.exec(["push"])
  }

  async exec(args: string[], additionalEnv?: { [key: string]: string }): Promise<string> {
    // Ref: https://github.com/actions/checkout/blob/a81bbbf8298c0fa03ea29cdc473d45769f953675/src/git-command-manager.ts#L425

    const env = { ...(process.env as any), ...additionalEnv } // eslint-disable-line @typescript-eslint/no-explicit-any
    const stdout: string[] = []

    const options = {
      cwd: this.repoPath,
      env,
      listeners: {
        stdout: (data: Buffer) => {
          stdout.push(data.toString())
        },
      },
    }

    // Here ignoreReturnCode is unset, resulting in error raised for non-0 exit code.
    const exitCode = await exec(`"${this.gitPath}"`, args, options)
    assert(exitCode === 0)
    // core.debug("stdout: " + stdout)
    return stdout.join("")
  }
}
