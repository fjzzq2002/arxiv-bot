'use strict';

const UTag = props => {
    const tag_name = props.tag;
    const turl = "/?rank=tags&tags=" + tag_name;
    return (
        <div class='rel_utag'>
            <a href={turl}>
                {tag_name}
            </a>
        </div>
    )
}

const renderMath = (text) => {
    if (!text) return text;
    
    // Split the text into math and non-math parts
    const parts = [];
    let lastIndex = 0;
    
    // Find all math expressions (both inline and display)
    const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^\$]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
    let match;
    
    while ((match = mathRegex.exec(text)) !== null) {
        // Add text before math
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index));
        }
        
        try {
            const math = match[0];
            const isDisplay = math.startsWith('$$') || math.startsWith('\\[');
            const tex = math.substring(isDisplay ? 2 : 1, math.length - (isDisplay ? 2 : 1));
            
            // Render the math
            const html = katex.renderToString(tex, {
                displayMode: isDisplay,
                throwOnError: false,
                trust: true,
                strict: false
            });
            parts.push(<span key={match.index} dangerouslySetInnerHTML={{__html: html}} />);
        } catch (e) {
            // If rendering fails, keep the original text
            parts.push(match[0]);
        }
        
        lastIndex = mathRegex.lastIndex;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
    }
    
    return parts;
}

const renderMarkdownAndMath = (text) => {
    if (!text) return text;
    
    // First render markdown
    const htmlContent = marked.parse(text.replaceAll('**',''));
    
    // Then find and render LaTeX in the HTML
    const parts = [];
    let lastIndex = 0;
    const mathRegex = /(\$\$[\s\S]*?\$\$|\$[^\$]*?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/g;
    let match;
    
    while ((match = mathRegex.exec(htmlContent)) !== null) {
        // Add HTML before math
        if (match.index > lastIndex) {
            parts.push(htmlContent.substring(lastIndex, match.index));
        }
        
        try {
            const math = match[0];
            const isDisplay = math.startsWith('$$') || math.startsWith('\\[');
            const tex = math.substring(isDisplay ? 2 : 1, math.length - (isDisplay ? 2 : 1));
            
            // Render the math
            const renderedMath = katex.renderToString(tex, {
                displayMode: isDisplay,
                throwOnError: false,
                trust: true,
                strict: false
            });
            parts.push(renderedMath);
        } catch (e) {
            // If rendering fails, keep the original text
            parts.push(match[0]);
        }
        
        lastIndex = mathRegex.lastIndex;
    }
    
    // Add remaining HTML
    if (lastIndex < htmlContent.length) {
        parts.push(htmlContent.substring(lastIndex));
    }
    
    return parts.join('');
}

const Paper = props => {
    const p = props.paper;

    const adder = () => fetch("/add/" + p.id + "/" + prompt("tag to add to this paper:"))
                        .then(response => console.log(response.text()));
    const subber = () => fetch("/sub/" + p.id + "/" + prompt("tag to subtract from this paper:"))
                        .then(response => console.log(response.text()));
    const utags = p.utags.map((utxt, ix) => <UTag key={ix} tag={utxt} />);
    const similar_url = "/?rank=pid&pid=" + p.id;
    const arxiv_url = `https://arxiv.org/abs/${p.id}`;
    const scholar_url = `https://scholar.google.com/scholar?q=arXiv:${p.id}`;
    const inspect_url = "/inspect?pid=" + p.id;
    const thumb_img = p.thumb_url === '' ? null : <div class='rel_img'><img src={p.thumb_url} /></div>;
    
    // Split authors and make them clickable
    const authorLinks = p.authors.split(', ').map((author, index) => {
        const searchUrl = `/?q=${encodeURIComponent(author)}`;
        return (
            <span key={index}>
                {index > 0 && ', '}
                <a href={searchUrl} class="author_link">{author}</a>
            </span>
        );
    });

    // if the user is logged in then we can show add/sub buttons
    let utag_controls = null;
    if(user) {
        utag_controls = (
            <div class='rel_utags'>
                <div class="rel_utag rel_utag_add" onClick={adder}>+</div>
                <div class="rel_utag rel_utag_sub" onClick={subber}>-</div>
                {utags}
            </div>
        )
    }

    return (
    <div class='rel_paper'>
        <div class="rel_score">{p.weight.toFixed(2)}</div>
        <div class='rel_title'>
            <a href={'https://www.alphaxiv.org/pdf/' + p.id} target="_blank">{renderMath(p.title)}</a>
        </div>
        <div class='rel_authors'>{authorLinks}</div>
        <div class='rel_scores'>
            <div>
            <span class="rel_score_span" title="Publication Date">📅 {p.time}</span>
            {p.score &&
                <span>
                {p.score.Reputation === 1 && <span class="rel_score_span" title="From Notable Author">⭐</span>}
                <span class="rel_score_span" title="Interpretability Score">🔍 {p.score.Interpretability}/10</span>
                <span class="rel_score_span" title="Understanding Score">💡 {p.score.Understanding}/10</span>
                <span class="rel_score_span" title="Surprisal Score">✨ {p.score.Surprisal}/10</span>
                </span>
            }
            </div>
        </div>
        {utag_controls}
        {thumb_img}
        <div class='rel_abs'>{renderMath(p.summary)}</div>
        <div class='rel_scores'>
            {p.scoring_result && 
                <div class='scoring_result'>
                    <div dangerouslySetInnerHTML={{__html: renderMarkdownAndMath(p.scoring_result)}} />
                </div>
            }
        </div>
        <div class='rel_more'>
            <a href={similar_url}>similar</a>
            <span class="rel_more_separator">·</span>
            <a href={scholar_url} target="_blank">scholar</a>
            <span class="rel_more_separator">·</span>
            <a href={arxiv_url} target="_blank">arxiv</a>
        </div>
    </div>
    )
}

const PaperList = props => {
    const lst = props.papers;
    const plst = lst.map((jpaper, ix) => <Paper key={ix} paper={jpaper} />);
    return (
        <div>
            <div id="paperList" class="rel_papers">
                {plst}
            </div>
        </div>
    )
}

const Tag = props => {
    const t = props.tag;
    const turl = "/?rank=tags&tags=" + t.name;
    const tag_class = 'rel_utag' + (t.name === 'all' ? ' rel_utag_all' : '');
    return (
        <div class={tag_class}>
            <a href={turl}>
                {t.n} {t.name}
            </a>
        </div>
    )
}

const TagList = props => {
    const lst = props.tags;
    const tlst = lst.map((jtag, ix) => <Tag key={ix} tag={jtag} />);
    const deleter = () => fetch("/del/" + prompt("delete tag name:"))
                          .then(response => console.log(response.text()));
    // show the #wordwrap element if the user clicks inspect
    const show_inspect = () => { document.getElementById("wordwrap").style.display = "block"; };
    const inspect_elt = words.length > 0 ? <div id="inspect_svm" onClick={show_inspect}>inspect</div> : null;
    return (
        <div>
            <div class="rel_tag" onClick={deleter}>-</div>
            <div id="tagList" class="rel_utags">
                {tlst}
            </div>
            {inspect_elt}
        </div>
    )
}

// render papers into #wrap
ReactDOM.render(<PaperList papers={papers} />, document.getElementById('wrap'));

// render tags into #tagwrap, if it exists
let tagwrap_elt = document.getElementById('tagwrap');
if (tagwrap_elt) {
    ReactDOM.render(<TagList tags={tags} />, tagwrap_elt);
}
