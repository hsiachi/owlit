// The acronyms researchers know common HCI and ML venues by, for the names the services give in full
// (OpenAlex, Crossref): only names whose acronym is the venue's own, never made up from initials. A
// series name in place of the venue ("Lecture Notes in Computer Science") isn't one, and stays as it is.
const VENUES: Record<string, string> = {
  // HCI
  "ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies": "IMWUT",
  "ACM on Human-Computer Interaction": "PACM HCI",
  "ACM Transactions on Computer-Human Interaction": "TOCHI",
  "CHI Conference on Human Factors in Computing Systems": "CHI",
  "Conference on Human Factors in Computing Systems": "CHI",
  "Extended Abstracts of the CHI Conference on Human Factors in Computing Systems": "CHI EA",
  "CHI Conference on Human Factors in Computing Systems Extended Abstracts": "CHI EA",
  "Annual ACM Symposium on User Interface Software and Technology": "UIST",
  "ACM Symposium on User Interface Software and Technology": "UIST",
  "ACM Conference on Computer-Supported Cooperative Work and Social Computing": "CSCW",
  "ACM Conference on Computer Supported Cooperative Work and Social Computing": "CSCW",
  "ACM Designing Interactive Systems Conference": "DIS",
  "Designing Interactive Systems Conference": "DIS",
  "International Conference on Intelligent User Interfaces": "IUI",
  "ACM Conference on Intelligent User Interfaces": "IUI",
  "International Journal of Human-Computer Studies": "IJHCS",
  "International Journal of Human-Computer Interaction": "IJHCI",
  "IEEE Transactions on Visualization and Computer Graphics": "TVCG",
  "Computers in Human Behavior": "CHB",
  "Journal of the Association for Information Science and Technology": "JASIST",
  // ML, NLP, vision, IR
  "Advances in Neural Information Processing Systems": "NeurIPS",
  "Neural Information Processing Systems": "NeurIPS",
  "International Conference on Machine Learning": "ICML",
  "International Conference on Learning Representations": "ICLR",
  "AAAI Conference on Artificial Intelligence": "AAAI",
  "International Joint Conference on Artificial Intelligence": "IJCAI",
  "Annual Meeting of the Association for Computational Linguistics": "ACL",
  "Conference on Empirical Methods in Natural Language Processing": "EMNLP",
  "Conference of the North American Chapter of the Association for Computational Linguistics": "NAACL",
  "Transactions of the Association for Computational Linguistics": "TACL",
  "Journal of Machine Learning Research": "JMLR",
  "Transactions on Machine Learning Research": "TMLR",
  "IEEE/CVF Conference on Computer Vision and Pattern Recognition": "CVPR",
  "IEEE Conference on Computer Vision and Pattern Recognition": "CVPR",
  "IEEE/CVF International Conference on Computer Vision": "ICCV",
  "IEEE International Conference on Computer Vision": "ICCV",
  "European Conference on Computer Vision": "ECCV",
  "IEEE Transactions on Pattern Analysis and Machine Intelligence": "TPAMI",
  "ACM SIGKDD Conference on Knowledge Discovery and Data Mining": "KDD",
  "ACM SIGKDD International Conference on Knowledge Discovery and Data Mining": "KDD",
  "International ACM SIGIR Conference on Research and Development in Information Retrieval": "SIGIR",
  "ACM Web Conference": "WWW",
  "The Web Conference": "WWW",
}

// A name as compared: without "Proceedings of the", an edition ("29th", "2024"), punctuation and case,
// so "Proceedings of the 2024 CHI Conference on Human Factors…" finds the CHI entry
function key(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^\s*proceedings of\s+(the\s+)?/, "")
    .replace(/\b(\d+(st|nd|rd|th)|\d{4})\b/g, " ")
    .replace(/^\s*the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

const BY_KEY = new Map(Object.entries(VENUES).map(([name, acronym]) => [key(name), acronym]))

// The venue's own acronym, when it is one the table knows
export const venueAlias = (venue: string): string | undefined => BY_KEY.get(key(venue))
