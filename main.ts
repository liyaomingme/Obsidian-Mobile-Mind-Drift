import { App, Plugin, TFile } from 'obsidian';

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'https', 'com', 'org', 
    'www', 'are', 'can', 'not', 'you', 'your', 'have', 'was', 'but', 'all', 
    'what', 'http', 'html', 'file', 'png', 'jpg', 'out', 'has', 'will', 'use',
    'which', 'when', 'more', 'about', 'their', 'there', 'some', '因此', '通过',
    '可以', '一个', '没有', '我们', '什么', '这个', '如果是', '怎么', '如果',
    '可以说', '这样', '很多', '非常', '进行', '然后', '可能', '因为', '所以',
    '各位', '谢谢', '由于', '其实', '只要', '目前', '开始'
]);

interface SphereNode {
    el: HTMLElement;
    lx: number; ly: number; lz: number; 
    zRatio: number;
}

// --- 移动端专属：纯装饰级极简物理引擎 (零交互、纯匀速) ---
class WordSphereDecorativeEngine {
    container: HTMLElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    radius: number;
    width: number = 0;
    height: number = 0;
    tags: SphereNode[] = [];
    
    // 自然匀速滚动
    velocityX = 0.0025; 
    velocityY = 0.0025;

    animationFrameId: number = 0;
    isActive = true;
    resizeObserver: any; 

    constructor(container: HTMLElement, radius: number) {
        this.container = container;
        this.radius = radius;
        
        this.canvas = document.createElement('canvas');
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '0';
        this.canvas.style.left = '0';
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.container.appendChild(this.canvas);
        
        const context = this.canvas.getContext('2d');
        if (!context) throw new Error("Canvas 2D context not supported");
        this.ctx = context;

        this.handleResize();

        const RO = (window as any).ResizeObserver;
        if (RO) {
            this.resizeObserver = new RO(() => this.handleResize());
            this.resizeObserver.observe(this.container);
        }
    }

    private handleResize() {
        const rect = this.container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        
        // 居中缩小：保证四周有充分留白
        const safeRadiusWidth = (rect.width / 2) - 30; 
        const safeRadiusHeight = (rect.height / 2) - 30;
        let newRadius = Math.min(safeRadiusWidth, safeRadiusHeight);
        newRadius = Math.max(newRadius, 40); 

        if (this.radius > 0 && this.tags.length > 0 && this.radius !== newRadius) {
            const scaleFactor = newRadius / this.radius;
            this.tags.forEach(tag => {
                tag.lx *= scaleFactor;
                tag.ly *= scaleFactor;
                tag.lz *= scaleFactor;
            });
        }
        
        this.radius = newRadius;

        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.width = rect.width;
        this.height = rect.height;
    }

    addTag(tagEl: HTMLElement) {
        tagEl.style.position = 'absolute';
        tagEl.style.left = '50%';
        tagEl.style.top = '50%';
        tagEl.style.willChange = 'transform, opacity, filter, color';
        tagEl.style.zIndex = '10'; 
        
        const count = this.tags.length;
        const offset = 2 / 35; // 控制在 35 个词以内，防拥挤
        const increment = Math.PI * (3 - Math.sqrt(5));
        const y = ((count * offset) - 1) + (offset / 2);
        const r = Math.sqrt(1 - y * y);
        const phi = (count % 35) * increment;
        
        const x = Math.cos(phi) * r * this.radius;
        const cy = y * this.radius;
        const z = Math.sin(phi) * r * this.radius;

        this.tags.push({
            el: tagEl,
            lx: x, ly: cy, lz: z,
            zRatio: z / this.radius,
        });
        
        this.container.appendChild(tagEl);
    }

    startAnimation() {
        if (this.tags.length === 0) return;

        const getComputedColor = (cssVar: string, fallback: string) => {
            const val = getComputedStyle(document.body).getPropertyValue(cssVar).trim();
            return val || fallback;
        };

        const animate = () => {
            if (!this.isActive) return;

            this.ctx.clearRect(0, 0, this.width, this.height);
            const cx = this.width / 2;
            const cy = this.height / 2;

            const colorNormal = getComputedColor('--text-normal', '#333333');
            const neutralLineColor = '128, 128, 128'; 

            // 极简纯坐标旋转计算
            this.tags.forEach(tag => {
                const x1 = tag.lx * Math.cos(this.velocityY) - tag.lz * Math.sin(this.velocityY);
                const z1 = tag.lz * Math.cos(this.velocityY) + tag.lx * Math.sin(this.velocityY);
                const y1 = tag.ly * Math.cos(this.velocityX) - z1 * Math.sin(this.velocityX);
                const z2 = z1 * Math.cos(this.velocityX) + tag.ly * Math.sin(this.velocityX);
                tag.lx = x1; tag.ly = y1; tag.lz = z2;
                tag.zRatio = z2 / this.radius;
            });

            const renderList = [...this.tags].sort((a, b) => a.lz - b.lz);

            renderList.forEach(item => {
                if (item.lz >= 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, 2, 0, Math.PI * 2); 
            this.ctx.fillStyle = colorNormal;
            this.ctx.fill();

            renderList.forEach(item => {
                if (item.lz < 0) return;
                this.drawConnectionLine(cx, cy, item, neutralLineColor);
            });

            renderList.forEach(item => {
                const tag = item;
                let baseOpacity = 0; let blur = 0; let color = 'var(--text-faint)';
                
                // 光学景深
                if (item.zRatio > 0.4) {
                    baseOpacity = 0.9; blur = 0; color = 'var(--text-normal)'; 
                } else if (item.zRatio > 0) {
                    baseOpacity = 0.4 + 0.5 * (item.zRatio / 0.4); blur = 0; color = 'var(--text-muted)'; 
                } else {
                    baseOpacity = 0.1 + 0.3 * ((item.zRatio + 1) / 1); 
                    blur = Math.min(2.0, Math.abs(item.zRatio) * 2.0); color = 'var(--text-faint)';
                }

                const depthScale = 0.6 + 0.5 * ((this.radius + tag.lz) / (2 * this.radius)); 
                const baseTransform = `translate(-50%, -50%) translate3d(${tag.lx}px, ${tag.ly}px, 0px)`;
                
                tag.el.style.transform = `${baseTransform} scale(${depthScale})`;
                tag.el.style.opacity = baseOpacity.toString();
                tag.el.style.color = color;
                tag.el.style.filter = `blur(${blur}px)`;
                tag.el.style.zIndex = Math.round(tag.lz + this.radius).toString();
            });

            this.animationFrameId = window.requestAnimationFrame(animate);
        };

        animate();
    }

    private drawConnectionLine(cx: number, cy: number, item: SphereNode, neutralRGB: string) {
        let depthOpacity = 0;
        let depthWidth = 0.3;
        
        if (item.zRatio > 0) {
            depthOpacity = 0.05 + 0.12 * item.zRatio; 
            depthWidth = 0.3 + 0.3 * item.zRatio;
        } else {
            depthOpacity = 0.05 * (1 - Math.abs(item.zRatio)); 
            depthWidth = 0.3;
        }

        if (depthOpacity <= 0) return;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.moveTo(cx, cy);
        this.ctx.lineTo(cx + item.lx, cy + item.ly);
        this.ctx.lineWidth = Math.max(0.1, depthWidth);
        this.ctx.strokeStyle = `rgba(${neutralRGB}, ${depthOpacity})`;
        this.ctx.stroke();
        this.ctx.restore();
    }

    destroy() {
        this.isActive = false;
        if (this.animationFrameId) window.cancelAnimationFrame(this.animationFrameId);
        if (this.resizeObserver) this.resizeObserver.disconnect();
    }
}

// --- 移动端随机装饰词汇提取 (过滤代码，专注文章质感) ---
async function analyzeDecorativeData(app: App) {
    const files = app.vault.getMarkdownFiles();
    // 打乱文件列表，随机选取 10 篇作为语料池
    const sampleFiles = files.sort(() => 0.5 - Math.random()).slice(0, 10);
    const wordsPool = new Set<string>();
    const results = [];

    for (const file of sampleFiles) {
        const content = await app.vault.cachedRead(file);
        // 暴力清洗所有代码块、URL、特殊符号
        const cleanText = content
            .replace(/```[\s\S]*?```/g, ' ') 
            .replace(/---[\s\S]*?---/, ' ')  
            .replace(/<[^>]*>?/gm, ' ')      
            .replace(/https?:\/\/[^\s]+/g, ' ') 
            .replace(/[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, ' ') 
            .replace(/[0-9a-fA-F]{8,}/g, ' '); 

        let segments: any[] = [];
        const IntlAny = (window as any).Intl;
        if (IntlAny && IntlAny.Segmenter) {
            const segmenter = new IntlAny.Segmenter('zh-CN', { granularity: 'word' });
            segments = (Array as any).from(segmenter.segment(cleanText));
        } else {
            const fallbackWords = cleanText.match(/[\u4e00-\u9fa5]{2,}|\b[a-zA-Z]{4,}\b/g) || [];
            segments = fallbackWords.map((w: string) => ({ segment: w, isWordLike: true }));
        }

        for (const { segment, isWordLike } of segments) {
            if (!isWordLike) continue; 
            const w = segment.trim();
            if (w.length < 2) continue;
            if (STOP_WORDS.has(w.toLowerCase())) continue;

            // 核心过滤：剔除全是小写字母的词 (通常是代码变量如 json, github, api)
            // 只保留中文，或者包含大写字母的专业名词
            if (/^[a-z]+$/.test(w)) continue; 

            if (!wordsPool.has(w)) {
                wordsPool.add(w);
                results.push({
                    word: w,
                    // 为装饰球赋予 1~10 的随机权重，制造错落有致的字号排版
                    value: Math.floor(Math.random() * 10) + 1 
                });
            }
        }
    }

    // 随机打乱并只取 30 个词汇，保证球体空灵不拥挤
    return results.sort(() => 0.5 - Math.random()).slice(0, 30);
}

export default class MobileStatsPlugin extends Plugin {
    sphereEngine: WordSphereDecorativeEngine | null = null;
    injectedContainer: HTMLElement | null = null;

    async onload() {
        this.app.workspace.onLayoutReady(() => {
            this.injectIntoFileExplorer();
        });

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.injectIntoFileExplorer();
        }));
    }
    
    async onunload() { 
        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();
    }
    
    async injectIntoFileExplorer() {
        const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
        if (fileExplorerLeaves.length === 0) return; 

        const fileExplorerContainer = fileExplorerLeaves[0].view.containerEl;
        const navContainer = fileExplorerContainer.querySelector('.nav-files-container');
        if (!navContainer) return;

        if (this.injectedContainer && this.injectedContainer.parentElement === navContainer) {
            return;
        }

        if (this.sphereEngine) this.sphereEngine.destroy();
        if (this.injectedContainer) this.injectedContainer.remove();

        this.injectedContainer = document.createElement('div');
        this.injectedContainer.className = 'mobile-parasitic-heatmap';
        
        // 核心 UI 重构：移除头部文字和图标，彻底变为纯装饰容器
        // 高度减小，上下 margin 留白居中，最重要的是 pointer-events: none (手指完全穿透！)
        this.injectedContainer.setAttribute('style', `
            width: 100%;
            height: 240px; 
            margin-top: 15px;
            margin-bottom: 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            position: relative;
            background-color: transparent;
            pointer-events: none; /* 事件穿透，彻底解决滚动冲突 */
        `);

        // 画布容器
        const heatmapDiv = this.injectedContainer.createDiv({ 
            attr: { style: 'width: 100%; height: 100%; display: flex; justify-content: center; align-items: center; overflow: hidden; position: relative;' } 
        });

        navContainer.appendChild(this.injectedContainer);
        
        const heatmapWords = await analyzeDecorativeData(this.app);

        // 动态半径稍微缩小，居中更美观
        const baseRadius = Math.max((heatmapDiv.clientWidth / 2) * 0.7, 45); 

        this.sphereEngine = new WordSphereDecorativeEngine(heatmapDiv, baseRadius);

        heatmapWords.forEach(({word, value}) => {
            const wordEl = document.createElement('div');
            wordEl.innerText = word;
            
            // 手机端字号调小，错落排布
            const fontSize = Math.max(13, Math.min(24, 13 + (value/10)*11));
            const fontWeight = value > 6 ? '700' : '400'; 

            wordEl.setAttr("style", `
                font-family: "SimSun", "STSong", "Songti SC", serif;
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                letter-spacing: 0.5px;
                white-space: nowrap;
                user-select: none;
                transform-origin: center center;
            `);
            
            this.sphereEngine!.addTag(wordEl);
        });

        this.sphereEngine.startAnimation();
    }
}
