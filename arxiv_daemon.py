"""
This script is intended to wake up every 30 min or so (eg via cron),
it checks for any new arxiv papers via the arxiv API and stashes
them into a sqlite database.
"""

import sys
import time
import random
import logging
import argparse

from aslite.arxiv import get_response, parse_response
from aslite.db import get_papers_db, get_metas_db

good_authors = list(map(str.lower, [
    # interp people I know
    'Jacob Andreas',
    'Neel Nanda',
    'Jacob Steinhardt',
    'Aditi Raghunathan',
    'Lijie Chen',
    'Phillip Isola',
    'Ziming Liu',
    'Yann LeCun',
    'Yoshua Bengio',
    'Geoffrey Hinton',
    'Juergen Schmidhuber'
]))

prompt_deepseek = """The following is the abstract of a new paper:

====================
$$$
====================

For the given paper, in the scale of 1 to 10, rate

(Interpretability) If it is directly related to model interpretability. For example, a paper that uses mechanistic interpretability methods or creates new interpretability methods and models that are more interpretable should get a high score.
(Understanding) If it improves our understanding of artificial systems. For example, a paper that reveals a deficiency of language model or a paper that reveals a surprising training dynamics of vision model should get a high score.
(Surprisal) In general how surprising is the paper's result. Roughly speaking, how new or interesting the work is to a general AI audience. Any "big" result could fit in this category.

Provide your scores in the following format:
Interpretability: ?/10
Understanding: ?/10
Surprisal: ?/10

Start your response with "1. Interpretability". BE CONSERVATIVE. For each metric, first explain your reasoning, then conclude with your final score (e.g. "**Interpretability: 2/10**")."""

import re
import asyncio
from openai import AsyncOpenAI

client = AsyncOpenAI(api_key=open('deepseek_api_key').read(), base_url="https://api.deepseek.com")

async def get_deepseek_response(prompt):
    try:
        response = await client.chat.completions.create(
            model="deepseek-chat",
            messages=[
                {"role": "user", "content": prompt},
            ],
            stream=False
        )
        # print(prompt, response.choices[0].message.content)
        return response.choices[0].message.content
    except:
        return ''

def clean(x):
    x = x.replace('\n', ' ').replace('\t', ' ').replace('\r', ' ').strip()
    x = re.sub(r'\s+', ' ', x)
    return x

async def deepseek_score(title, abstract, retry_count=3):
    prompt = prompt_deepseek.replace('$$$', clean(title)+'\n\n'+clean(abstract))
    score_maxlen = {}
    best_resp = ""
    for _ in range(retry_count):
        resp = await get_deepseek_response(prompt)
        score = {}
        # try to match Interpretability: ?/10
        for metric in ['Interpretability', 'Understanding', 'Surprisal']:
            match = re.search(f'{metric}: (\\d+)/10', resp)
            if match:
                score[metric] = int(match.group(1))
        if len(score) > len(score_maxlen) or (len(score) == len(score_maxlen) and len(resp) > len(best_resp)):
            score_maxlen = score
            best_resp = resp
        if len(score_maxlen) == 3:
            break
    return score_maxlen, best_resp

async def get_score(paper):
    title = paper['title']
    abstract = paper['summary']
    authors = paper['authors']
    score, best_resp = await deepseek_score(title, abstract)
    score['Reputation'] = 1 if any(author['name'].lower() in good_authors for author in authors) else 0
    # print(title, score)
    return score, best_resp

async def run_daemon():
    logging.basicConfig(level=logging.INFO, format='%(name)s %(levelname)s %(asctime)s %(message)s', datefmt='%m/%d/%Y %I:%M:%S %p')

    parser = argparse.ArgumentParser(description='Arxiv Daemon')
    parser.add_argument('-n', '--num', type=int, default=200, help='up to how many papers to fetch')
    parser.add_argument('-s', '--start', type=int, default=0, help='start at what index')
    parser.add_argument('-b', '--break-after', type=int, default=3, help='how many 0 new papers in a row would cause us to stop early? or 0 to disable.')
    args = parser.parse_args()
    print(args)
    """
    Quick note on the break_after argument: In a typical setting where one wants to update
    the papers database you'd choose a slightly higher num, but then break out early in case
    we've reached older papers that are already part of the database, to spare the arxiv API.
    """

    # query string of papers to look for
    q = 'cat:cs.CV+OR+cat:cs.LG+OR+cat:cs.CL+OR+cat:cs.AI+OR+cat:cs.RO'  # +OR+cat:cs.NE

    pdb = get_papers_db(flag='c')
    mdb = get_metas_db(flag='c')
    prevn = len(pdb)

    def store(p):
        pdb[p['_id']] = p
        mdb[p['_id']] = {'_time': p['_time']}

    # fetch the latest papers
    total_updated = 0
    zero_updates_in_a_row = 0
    for k in range(args.start, args.start + args.num, 500):
        logging.info('querying arxiv api for query %s at start_index %d' % (q, k))

        # attempt to fetch a batch of papers from arxiv api
        ntried = 0
        while True:
            try:
                resp = get_response(search_query=q, start_index=k)
                papers = parse_response(resp)
                time.sleep(0.5)
                if len(papers) == 500:
                    break # otherwise we have to try again
            except Exception as e:
                logging.warning(e)
                logging.warning("will try again in a bit...")
                ntried += 1
                if ntried > 1000:
                    logging.error("ok we tried 1,000 times, something is srsly wrong. exitting.")
                    sys.exit()
                time.sleep(2 + random.uniform(0, 4))

        # process the batch of retrieved papers
        nhad, nnew, nreplace = 0, 0, 0
        to_store = []
        for p in papers:
            pid = p['_id']
            if pid in pdb:
                if p['_time'] > pdb[pid]['_time']:
                    # replace, this one is newer
                    to_store.append(p)
                    nreplace += 1
                else:
                    # we already had this paper, nothing to do
                    nhad += 1
            else:
                # new, simple store into database
                to_store.append(p)
                nnew += 1
        # get all scores
        score_resp = await asyncio.gather(*[get_score(p) for p in to_store])
        for p, (score, resp) in zip(to_store, score_resp):
            p['score'] = score
            p['scoring_result'] = resp
            store(p)
        prevn = len(pdb)
        total_updated += nreplace + nnew

        # some diagnostic information on how things are coming along
        logging.info(papers[0]['_time_str'])
        logging.info("k=%d, out of %d: had %d, replaced %d, new %d. now have: %d" %
             (k, len(papers), nhad, nreplace, nnew, prevn))

        # early termination criteria
        if 0:#nnew == 0:
            zero_updates_in_a_row += 1
            if args.break_after > 0 and zero_updates_in_a_row >= args.break_after:
                logging.info("breaking out early, no new papers %d times in a row" % (args.break_after, ))
                break
            elif k == 0:
                logging.info("our very first call for the latest there were no new papers, exitting")
                break
        else:
            zero_updates_in_a_row = 0

        # zzz
        time.sleep(1 + random.uniform(0, 3))

    # exit with OK status if anything at all changed, but if nothing happened then raise 1
    sys.exit(0 if total_updated > 0 else 1)

if __name__ == '__main__':
    asyncio.run(run_daemon())
