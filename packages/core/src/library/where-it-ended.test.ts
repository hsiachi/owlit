import { describe, expect, it } from "vitest"
import { whereItEnded } from "./where-it-ended.ts"

// Pages a real run left in Dia (off campus, through Tsinghua's tlink), and a few other
// schools' sign-ins
describe("where a tab in the user's browser ended", () => {
  const sage = { address: "https://journals.sagepub.com/doi/pdf/10.1177/0146167212445599?download=true", proxy: "https://tlink.lib.tsinghua.edu.cn/go" }
  const sd = { address: "https://doi.org/10.1016/j.invent.2014.11.004", proxy: "https://tlink.lib.tsinghua.edu.cn/go" }
  const acm = { address: "https://dl.acm.org/doi/pdf/10.1145/3698204.3716449?download=true" }

  it("tells a publisher's no from a check and from a page still at the PDF", () => {
    expect(whereItEnded({ url: "https://journals.sagepub.com/doi/abs/10.1177/0146167212445599?download=true", title: "Self-Compassion Increases Self-Improvement Motivation - Juliana G. Breines, 2012" }, sage)).toBe("no-access")
    expect(whereItEnded({ url: "https://www.tandfonline.com/doi/pdf/10.1080/09507116.2025.2463156?download=true", title: "Editorial: Welding International: Vol 39 , No 2 - Get Access" }, { address: "https://www.tandfonline.com/doi/pdf/10.1080/09507116.2025.2463156?download=true" })).toBe("no-access")
    expect(whereItEnded({ url: "https://dl.acm.org/doi/pdf/10.1145/3698204.3716449?download=true&__cf_chl_tk=x", title: "Just a moment..." }, acm)).toBe("check")
    expect(whereItEnded({ url: "https://dl.acm.org/doi/pdf/10.1145/3698204.3716449?download=true", title: "dl.acm.org" }, acm)).toBe("on-pdf")

    // An ACL paper the ACM lists without its PDF: nothing there to answer
    expect(whereItEnded({ url: "https://dl.acm.org/doi/pdf/10.3115/1654595.1654614?download=true", title: "ACM Error: 404" }, { address: "https://dl.acm.org/doi/pdf/10.3115/1654595.1654614?download=true" })).toBe("missing")
    expect(whereItEnded({ url: "https://journals.sagepub.com/doi/pdf/10.1177/x?download=true", title: "Page Not Found | SAGE Journals" }, sage)).toBe("missing")
  })

  it("reads a proxy's rewrite of the publisher as the publisher", () => {
    expect(
      whereItEnded(
        { url: "https://libproxy.qh.yitlink.com:8444/https/443/com/sagepub/journals/yitlink/doi/abs/10.1177/0146167212445599", title: "Self-Compassion…" },
        sage,
      ),
    ).toBe("no-access")
    expect(whereItEnded({ url: "https://journals-sagepub-com.ezproxy.lib.example.edu/doi/abs/10.1177/0146167212445599", title: "x" }, sage)).toBe("no-access")
  })

  it("finds a sign-in wherever the school keeps it", () => {
    expect(whereItEnded({ url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/f2841607a1c6b880847ee635cc5046f0/1", title: "清华大学用户电子身份服务系统" }, sage)).toBe("sign-in")
    expect(whereItEnded({ url: "https://login.openathens.net/auth/example.ac.uk/o/12345?t=%2Fsaml%2F2%2Fsso%2Fsagepub.com", title: "Sign in" }, sage)).toBe("sign-in")
    expect(whereItEnded({ url: "https://idp.example.edu/idp/profile/SAML2/Redirect/SSO?execution=e1s1", title: "Web Login Service" }, sage)).toBe("sign-in")
    expect(whereItEnded({ url: "https://iam.atypon.com/action/saml2post", title: "iam.atypon.com/action/saml2post" }, sage)).toBe("sign-in")
    // The proxy's own entry, still there: its gateway of sign-in buttons
    expect(whereItEnded({ url: "https://tlink.lib.tsinghua.edu.cn/go?url=https://journals.sagepub.com/doi/pdf/x", title: "清华大学图书馆智能资源网关" }, sage)).toBe("sign-in")
    // A sign-in carrying the publisher in its query is still a sign-in
    expect(whereItEnded({ url: "https://cas.example.edu/cas/login?service=https%3A%2F%2Fjournals.sagepub.com%2Fdoi%2Fpdf", title: "Central Authentication" }, sage)).toBe("sign-in")
    // Some other school's page owlit has never seen
    expect(whereItEnded({ url: "https://shib.uni-example.de/start", title: "Universität Beispiel" }, sage)).toBe("sign-in")
  })

  it("tells the proxy's no from its limit", () => {
    expect(
      whereItEnded({ url: "https://libproxy.qh.yitlink.com:8444/ui/minute-limit?url=https://www.sciencedirect.com/science/article/pii/S2214782914000347", title: "Access Denied" }, sd),
    ).toBe("limit")
    expect(
      whereItEnded({ url: "https://tlink.lib.tsinghua.edu.cn/ui/unauthorized?url=https://misq.umn.edu/misq/article/42/2/355", title: "清华大学图书馆智能资源网关" }, { address: "https://doi.org/10.25300/misq/2018/14124", proxy: "https://tlink.lib.tsinghua.edu.cn/go" }),
    ).toBe("refused")
    // A publisher's article whose path says "limitations" is the publisher's page, not a limit
    expect(whereItEnded({ url: "https://academic.oup.com/jcr/article/37/3/409/1827617/limitations-of-choice", title: "Can There Ever Be Too Many Options?" }, { address: "https://academic.oup.com/jcr/article/37/3/409/1827617" })).toBe("no-access")
  })

  it("can't tell from nothing", () => {
    expect(whereItEnded({ url: "", title: "" }, sage)).toBe("unknown")
    expect(whereItEnded({ url: "about:blank", title: "" }, sage)).toBe("unknown")
  })

  it("takes an article page that landed as landed, and still finds a sign-in or a no in front of it", () => {
    const page = { address: "https://doi.org/10.1016/j.chb.2019.07.016", proxy: "https://tlink.lib.tsinghua.edu.cn/go", page: true }
    expect(
      whereItEnded(
        { url: "https://libproxy.qh.yitlink.com:8444/https/443/com/sciencedirect/www/yitlink/science/article/pii/S0747563219302596?via%3Dihub", title: "Batching smartphone notifications can improve well-being - ScienceDirect" },
        page,
      ),
    ).toBe("landed")
    expect(whereItEnded({ url: "https://www.sciencedirect.com/science/article/pii/S0747563219302596", title: "Batching smartphone notifications - ScienceDirect" }, { address: page.address, page: true })).toBe("landed")
    // An OUP article whose path says what it is about
    expect(whereItEnded({ url: "https://libproxy.qh.yitlink.com:8444/https/443/com/oup/academic/yitlink/jcr/article/37/3/409/authentication-limits", title: "Can There Ever Be Too Many Options?" }, page)).toBe("landed")
    expect(whereItEnded({ url: "https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/x/1", title: "清华大学用户电子身份服务系统" }, page)).toBe("sign-in")
    expect(whereItEnded({ url: "https://tlink.lib.tsinghua.edu.cn/ui/unauthorized?url=https://misq.umn.edu/misq/article/42/2/355", title: "清华大学图书馆智能资源网关" }, page)).toBe("refused")
    expect(whereItEnded({ url: "https://www.sciencedirect.com/science/article/pii/S0747563219302596", title: "Just a moment..." }, page)).toBe("check")
  })

  it("doesn't read sign-in words inside other words", () => {
    // Article pages doi.org sent a run to: "sso" in "Lessons" and "Association"
    const bmj = { address: "https://doi.org/10.1136/qhc.12.4.304", page: true }
    expect(whereItEnded({ url: "https://qualitysafety.bmj.com/content/12/4/304", title: "Lessons from a hospital | BMJ Quality & Safety" }, bmj)).toBe("landed")
    const apa = { address: "https://doi.org/10.1037/0022-3514.54.4.569", page: true }
    expect(whereItEnded({ url: "https://psycnet.apa.org/record/1988-25536-001", title: "PsycNET Record | American Psychological Association" }, apa)).toBe("landed")
    // "auth" beginning other words, in a title and in a path
    expect(whereItEnded({ url: "https://www.example-journal.org/article/authentic-leadership", title: "Authentic leadership and its authors | Authority" }, apa)).toBe("landed")
    expect(whereItEnded({ url: "https://www.example-journal.org/processors/assessor", title: "Processor design" }, apa)).toBe("landed")
    // Whole words still are, camelCase ones too
    expect(whereItEnded({ url: "https://authserver.example.edu.cn/authserver/login?service=x", title: "统一身份认证" }, apa)).toBe("sign-in")
    expect(whereItEnded({ url: "https://www.example-journal.org/action/showLoginForm", title: "Example" }, apa)).toBe("sign-in")
    expect(whereItEnded({ url: "https://accounts.example.com/oauth2/authorize", title: "Example" }, apa)).toBe("sign-in")
    expect(whereItEnded({ url: "https://www.example-journal.org/sso/start", title: "Example" }, apa)).toBe("sign-in")
  })
})
