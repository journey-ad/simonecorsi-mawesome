import path from 'path';
import * as core from '@actions/core';
import { readFile } from 'fs/promises';
import { Octokit } from '@octokit/rest';

import {
  renderer,
  REPO_USERNAME,
  generateMd,
  MARKDOWN_FILENAME,
} from './helpers';
import git from './git';

function compactByLanguage(stars: Record<string, any>[]) {
  return stars.reduce((acc: Record<string, any[]>, star) => {
    const lang = star.language || 'miscellaneous';
    (acc[lang] ??= []).push(star);
    return acc;
  }, {});
}

export async function main() {
  let template = await readFile(
    path.resolve(__dirname, './TEMPLATE.ejs'),
    'utf8'
  );

  const customTemplatePath = core.getInput('template-path');
  core.info(`check if customTemplatePath: ${customTemplatePath} exists`);
  try {
    template = await readFile(customTemplatePath, 'utf8');
  } catch {
    core.info("Couldn't find template file, using default");
  }

  const token = core.getInput('api-token', { required: true });
  const octokit = new Octokit({ auth: token });

  const stars: Record<string, any>[] = [];

  core.info('Fetching starred repos with starred_at...');
  for await (const response of octokit.paginate.iterator(
    octokit.rest.activity.listReposStarredByAuthenticatedUser,
    {
      per_page: 100,
      headers: { accept: 'application/vnd.github.v3.star+json' },
    }
  )) {
    for (const item of response.data as any[]) {
      stars.push({
        ...item.repo,
        starred_at: item.starred_at,
      });
    }
  }
  core.info(`Fetched ${stars.length} starred repos`);

  const compactedByLanguage = compactByLanguage(stars);
  const byLanguage = await renderer(
    {
      username: REPO_USERNAME,
      stars: Object.entries(compactedByLanguage),
      updatedAt: Date.now(),
    },
    template
  );

  const files = [
    {
      filename: MARKDOWN_FILENAME,
      data: await generateMd(byLanguage),
    },
    {
      filename: 'data.json',
      data: JSON.stringify(compactedByLanguage, null, 2),
    },
  ];

  await git.pushNewFiles(files);
}

export async function run(): Promise<void> {
  try {
    await main();
  } catch (error) {
    core.setFailed(`#run: ${error}`);
  }
}

const catchAll = (info: string) => {
  core.setFailed(`#catchAll: ${info}`);
  core.error(info);
};
process.on('unhandledRejection', catchAll);
process.on('uncaughtException', catchAll);

run().catch(core.error);
