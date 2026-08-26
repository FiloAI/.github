import { ownerApprovalMarker } from './high-risk-review-gate.mjs'
import { isMergeOwner } from './merge-owner-logins.mjs'

const SEVERITY_PATTERN =
  /(?:alt=["']?P([0123])["']?|badge\/P([0123])-|\bP([0123])\b)/i

const SEVERITY_CHANGE_PATTERN =
  /\b(?:promot(?:e|ed|ing)|rais(?:e|ed|ing))\b[^.\n]{0,40}\b(?:from\s+P[0123]\s+)?to\s+P[0123]\b|\b(?:downgrad(?:e|ed|ing)|upgrad(?:e|ed|ing)|escalat(?:e|ed|ing)|reclassif(?:y|ied|ying)|severity|priority|should\s+be)\b|(?:降级|升级|提高|降低|调整|改为|定为)/i

const PRODUCT_DEFERRAL_PATTERN =
  /(?:产品(?:决定|决策|取舍)|不在本\s*PR\s*(?:修|改|处理)|超出(?:本\s*PR\s*)?范围|不改|不修|暂不处理|后续(?:处理|再处理|修复|解决|\s*PR|\s*issue)|另开(?:\s*PR|\s*issue)?|(?:会|将|将在)[^。！？!?\n]{0,24}(?:后续|以后|稍后|未来|下个|下一(?:个)?|另行)[^。！？!?\n]{0,24}(?:修复|处理|解决)|(?:下个|下一(?:个)?|以后|稍后|未来|另行)[^。！？!?\n]{0,24}(?:修复|处理|解决))|\b(?:product\s+(?:decision|trade-?off)|(?:(?:this|that)(?:\s+behavio(?:u)?r)?|it)\s+(?:is|'s)\s+(?:by\s+design|expected\s+behavio(?:u)?r)|keep(?:ing)?(?:\s+(?:this|it))?\s+as[-\s]+is|(?:i|we)(?:\s+will|['’]ll)\s+leave\s+(?:this|it)\s+(?:as[-\s]+is|unchanged)|(?:i(?:\s+am|['’]m)|we(?:\s+are|['’]re))\s+leaving\s+(?:this|it)\s+unchanged|out\s+of\s+scope|not\s+in\s+this\s+PR|(?:won['’]t|will\s+not)\s+(?:(?:be\s+)?(?:fixing|addressing|resolving)|be\s+(?:fixed|addressed|resolved)|fix|address|resolve|change\s+(?:this|it)(?=$|[.。！？!?,，;；:\n])|make\s+(?:(?:this|that|the\s+requested)\s+)?change)|(?:(?:i(?:\s+am|['’]m)|we(?:\s+are|['’]re))\s+not\s+(?:fixing|addressing|resolving)\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r))(?=$|[.。！？!?,，;；:\n]|\s+(?:in|here|now|before|after|until|because)\b))|(?:(?:i(?:\s+am|['’]m)|we(?:\s+are|['’]re))\s+not\s+going\s+to\s+(?:(?:be\s+)?(?:fixing|addressing|resolving)|be\s+(?:fixed|addressed|resolved)|fix|address|resolve))|(?:(?:i|we)\s+)?(?:do\s+not|don['’]t)\s+plan\s+to\s+(?:(?:be\s+)?(?:fixing|addressing|resolving)|be\s+(?:fixed|addressed|resolved)|fix|address|resolve)|(?:(?:i|we)\s+)?(?:have|has)\s+no\s+plans?\s+to\s+(?:(?:be\s+)?(?:fixing|addressing|resolving)|be\s+(?:fixed|addressed|resolved)|fix|address|resolve)|defer(?:red|ring)?|follow-?up\s+(?:PR|issue)|separate\s+(?:PR|issue)|(?:will|plan(?:ned)?\s+to|going\s+to)[^.\n]{0,40}(?:fix|address|resolve)[^.\n]{0,40}(?:later|follow-?up|next\s+(?:PR|pull\s+request))|(?:fix|address|resolve)[^.\n]{0,20}(?:this|it)[^.\n]{0,20}later)\b/i

const PRESENT_PROGRESSIVE_NO_CHANGE_PATTERN =
  /\b(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+not\s+(?:changing\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r))(?=$|[.。！？!?,，;；:\n]|\s+(?:in|here|now|before|after|until|because)\b)|making\s+(?:(?:this|that|the\s+requested)\s+)?change(?=$|[.。！？!?,，;；:\n]|\s+(?:in|here|now|before|after|until|because)\b))/i

const AUTHOR_PLANNED_NO_CHANGE_PATTERN =
  /(?:我|我们)(?:(?:不会|不打算|不准备)|(?:没有|没|并无)\s*(?:计划|打算|意图))[^。！？!?,，;；:\n]{0,20}(?:修改\s*(?:这个|该|此)?\s*(?:行为|实现)|(?:实施|进行|作出)\s*(?:(?:这个|该|此)\s*)?(?:所要求的|请求的)?\s*(?:修改|改动|变更))(?=$|[.。！？!?,，;；:\n]|\s+(?:在本\s*PR|这里|现在|目前|合并前|因为))|\b(?:(?:i|we)\s+(?:(?:(?:will\s+not|won['’]t)\s+)|(?:(?:do|did)\s+not|don['’]t|didn['’]t)\s+(?:plan|intend)\s+to\s+|(?:have|had)\s+no\s+plans?\s+to\s+)|(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+not\s+going\s+to\s+)(?:change\s+(?:(?:this|it)|the\s+(?:behavio(?:u)?r|implementation))|(?:make|implement|apply|adopt)\s+(?:(?:this|that|the\s+requested)\s+)?changes?)(?=$|[.。！？!?,，;；:\n]|\s+(?:(?:in\s+(?:this\s+)?(?:pr|pull\s+request))|here|now|before|after|until|because)\b)/i

const AUTHOR_EXPLICIT_REFUSAL_PATTERN =
  /\b(?:(?:i|we)\s+(?:refuse|decline)|(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+(?:refusing|declining)|(?:i|we)\s+(?:have|had)\s+(?:refused|declined)|(?:i|we)['’]ve\s+(?:refused|declined))\s+(?:to\s+(?:(?:fix|address|resolve)\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r))|change\s+(?:(?:this|it)|the\s+(?:behavio(?:u)?r|implementation))|(?:make|implement)\s+(?:(?:this|that|the\s+requested|any)\s+changes?))|(?:this|that|the\s+requested)\s+changes?)(?=$|[.。！？!?,，;；:\n]|\s+(?:in|here|now|before|after|until|because)\b)/i

const AUTHOR_DECISION_NO_FIX_PATTERN =
  /\b(?:i|we)(?:\s+(?:have|had)|['’]ve)?\s+(?:decid(?:e|ed)|determin(?:e|ed)|cho(?:ose|se|sen)|opt(?:ed)?)\s+(?:not\s+to|against)\s+(?:(?:be\s+)?(?:fix(?:ing)?|address(?:ing)?|resolv(?:e|ing))\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r))|chang(?:e|ing)\s+(?:(?:this|it)|the\s+(?:behavio(?:u)?r|implementation))|(?:mak(?:e|ing)|implement(?:ing)?)\s+(?:(?:this|that|the\s+requested)\s+)?changes?)(?=$|[.。！？!?,，;；:\n]|\s+(?:(?:in\s+(?:this\s+)?(?:pr|pull\s+request))|here|now|before|after|until|because)\b)/i

const AUTHOR_INTENTION_NO_FIX_PATTERN =
  /(?:我|我们)(?:(?:无意|(?:从未|没有|没|并无|无|不)\s*(?:打算|计划|意图|意愿|准备))|(?:的)?(?:打算|计划|意图|意愿)\s*(?:是|为)\s*(?:不|不会))[^。！？!?,，;；:\n]{0,24}(?:(?:修复|处理|解决)\s*(?:这个|该|此)?\s*(?:问题|finding|行为)|修改\s*(?:这个|该|此)?\s*(?:行为|实现)|(?:作出|进行|实现)\s*(?:(?:这个|该|此)\s*)?(?:所要求的|请求的)?\s*(?:修改|改动|变更))(?=$|[.。！？!?,，;；:\n]|\s+(?:在本\s*PR|这里|现在|目前|合并前|因为))|\b(?:(?:i|we)\s+(?:(?:(?:do|did)\s+not|don['’]t|didn['’]t)\s+intend|never\s+intended|(?:have|has|had)\s+(?:not|never)\s+intended|(?:am|are|was|were)\s+not\s+intending)\s+to|(?:i|we)\s+(?:have|has|had)\s+no\s+intention\s+of|(?:my|our)\s+intention\s+(?:is|was|has\s+been|had\s+been)\s+not\s+to)\s+(?:(?:fix(?:ing)?|address(?:ing)?|resolv(?:e|ing))\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r))|chang(?:e|ing)\s+(?:(?:this|it)(?:\s+(?:behavio(?:u)?r|implementation))?|the\s+(?:behavio(?:u)?r|implementation))|(?:mak(?:e|ing)|implement(?:ing)?)\s+(?:(?:this|that|the\s+requested)\s+)?changes?)(?=$|[.。！？!?,，;；:\n]|\s+(?:(?:in\s+(?:this\s+)?(?:pr|pull\s+request))|here|now|before|after|until|because)\b)/i

const AUTHOR_INABILITY_NO_FIX_PATTERN =
  /(?:我|我们)?(?:目前|现在|当前)?\s*(?:无法|不能|没法)\s*(?:在(?:本|这个|该)\s*PR(?:中|里)?\s*)?(?:(?:修复|处理|解决|修改)\s*(?:这个|该|此)?\s*(?:问题|finding|行为|实现)|(?:作出|进行|实现)\s*(?:这个|该|此|所要求的|请求的)?\s*(?:修改|改动|变更))(?=$|[.。！？!?,，;；:\n]|\s+(?:在本\s*PR|这里|现在|目前|合并前|因为))|\b(?:(?:(?:i|we)\s+(?:(?:can(?:not|\s+not)|can['’]t|could\s+not|couldn['’]t)\s+|(?:am|are|was|were)\s+(?:(?:currently|still)\s+)?(?:unable|not\s+able)\s+to\s+|(?:have|had)\s+been\s+unable\s+to\s+)|(?:cannot|can['’]t)\s+)(?:(?:fix|address|resolve)\s+(?:(?:this|it)|(?:this|that|the)\s+(?:issue|finding|behavio(?:u)?r))|change\s+(?:(?:this|it)|(?:this|that|the)\s+(?:behavio(?:u)?r|implementation))|(?:make|implement)\s+(?:(?:this|that|the\s+requested)\s+)?changes?)|(?:(?:this|it)|(?:this|that|the)\s+(?:issue|finding|behavio(?:u)?r))\s+(?:can(?:not|\s+not)|can['’]t|could\s+not|couldn['’]t)\s+be\s+(?:fixed|addressed|resolved|changed)|(?:this|that|the\s+requested)\s+changes?\s+(?:can(?:not|\s+not)|can['’]t|could\s+not|couldn['’]t)\s+be\s+(?:made|implemented))(?=$|[.。！？!?,，;；:\n]|\s+(?:(?:in\s+(?:this\s+)?(?:pr|pull\s+request))|here|now|yet|before|after|until|because)\b)/i

const AUTHOR_POSTPONED_FIX_PATTERN =
  /(?:我|我们)(?:已|已经|正在|曾经)?\s*(?:推迟|延期|搁置|暂停)[^。！？!?,，;；:\n]{0,20}(?:(?:修复|处理|解决)\s*(?:这个|该|此)?\s*(?:问题|finding|行为)|(?:修改|实施|进行)\s*(?:(?:这个|该|此)\s*)?(?:所要求的|请求的)?\s*(?:行为|实现|修改|改动|变更)|(?:(?:这个|该|此|所要求的|请求的)\s*)?(?:修改|改动|变更))(?=$|[.。！？!?,，;；:\n]|\s+(?:在本\s*PR|这里|现在|目前|合并前|因为))|\b(?:(?:i|we)\s+(?:(?:have|had)\s+|(?:am|are|was|were)\s+)?postpon(?:e|ed|ing)\s+(?:(?:fixing|addressing|resolving|changing|implementing)\s+(?:(?:this|it)|the\s+(?:issue|finding|behavio(?:u)?r|implementation|requested\s+change))|(?:(?:this|that|the\s+requested)\s+)?(?:fix|behavio(?:u)?r\s+change|implementation\s+change))|(?:i|we)\s+(?:(?:(?:have|had)\s+)?(?:put|placed)|(?:am|are|was|were)\s+(?:putting|placing))\s+(?:(?:this|that|the\s+requested)\s+)?(?:fix|behavio(?:u)?r\s+change|implementation\s+change)\s+on\s+hold|(?:(?:this|that|the\s+requested)\s+)?(?:fix|behavio(?:u)?r\s+change|implementation\s+change)\s+(?:is|was|has\s+been|had\s+been)\s+(?:postponed|put\s+on\s+hold|placed\s+on\s+hold))(?=$|[.。！？!?,，;；:\n]|\s+(?:(?:in\s+(?:this\s+)?(?:pr|pull\s+request))|here|now|before|after|until|because)\b)/i

const NEGATED_PRODUCT_DEFERRAL_PATTERN =
  /(?:不是|并非|并不是)\s*(?:产品(?:决定|决策|取舍)|不改|不修|暂不处理|超出(?:本\s*PR\s*)?范围)|\b(?:is\s+not|isn't|was\s+not|wasn't|not)\s+(?:a\s+)?(?:product\s+(?:decision|trade-?off)|by\s+design|expected\s+behavio(?:u)?r|out\s+of\s+scope|defer(?:red)?)\b|\b(?:do\s+not|don't|should\s+not|shouldn't|cannot|can't|won't|not)\s+keep(?:\s+(?:this|it))?\s+as[-\s]+is\b/gi

const NEGATED_FOLLOW_UP_DEFERRAL_PATTERN =
  /\b(?:no\s+(?:(?:follow-?up|separate)\s+(?:pr|pull\s+request|issue))\s+(?:is\s+)?(?:needed|required|necessary)|(?:i|we|this|it)\s+(?:(?:do|does)\s+not|don['’]t|doesn['’]t)\s+(?:need|require)\s+(?:a\s+)?(?:(?:follow-?up|separate)\s+(?:pr|pull\s+request|issue))|(?:a\s+)?(?:(?:follow-?up|separate)\s+(?:pr|pull\s+request|issue))\s+(?:is|are)\s+not\s+(?:needed|required|necessary))\b/gi

const INTENDED_BEHAVIOR_DEFERRAL_PATTERN =
  /\b(?:working\s+as\s+intended|intended\s+behavio(?:u)?r)\b/i

const NO_CHANGE_DEFERRAL_PATTERN =
  /\bno\s+changes?\s+(?:are\s+)?needed\b/i

const NON_BEHAVIOR_NO_CHANGE_PATTERN =
  /\bno\s+changes?\s+(?:are\s+)?needed\s+(?:to|for|in)\s+(?:the\s+)?(?:tests?|test\s+suite|docs?|documentation|comments?|formatting|snapshots?|fixtures?|mocks?|tooling|ci)\b/i

const NEGATED_INTENDED_BEHAVIOR_PATTERN =
  /\b(?:is\s+not|isn't|was\s+not|wasn't|not)\s+(?:working\s+as\s+intended|intended\s+behavio(?:u)?r)\b/gi

const REVIEWER_ACCEPTANCE_PATTERN =
  /(?:接受|同意)[^。！？!?\n]{0,32}(?:延期|取舍|范围(?:说明)?|另开|后续处理|单独处理)|(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)(?:修复|处理|解决)|可以另开|\b(?:accept(?:ed)?|agree(?:d)?)\b[^.。！？!?\n]{0,40}\b(?:deferral|trade-?off|scope|out\s+of\s+scope|follow-?up|separate\s+(?:concern|issue|pr))\b|\b(?:confirm(?:ed)?|verif(?:y|ied))\b[^.。！？!?\n]{0,32}\b(?:fixed|addressed|resolved)\b|\bmakes?\s+sense\b[^.。！？!?\n]{0,40}\b(?:scope|separate|follow-?up)\b|\bkeep\s+the\s+scope\s+tight\b/i

const REVIEWER_WITHDRAWAL_ACCEPTANCE_PATTERN =
  /(?:我|我们)(?:已|已经|现在)?\s*(?:撤回|收回)\s*(?:阻止|阻塞|反对|异议|变更请求)|\b(?:i|we)\s+(?:(?:have|['’]ve)\s+)?(?:withdrawn?|retract(?:ed)?)\s+(?:my|our|the|that)?\s*(?:blocker|objection|concern|request\s+for\s+changes)\b/i

const REVIEWER_SCOPED_NON_BLOCKING_ACCEPTANCE_PATTERN =
  /(?:产品取舍|延期(?:决定|处理)?|范围(?:说明|决定|取舍)?|单独处理(?:方案)?|另开(?:处理|事项)?|P[01]\s*(?:问题|finding)|(?:当前|这个|此|该)?\s*finding)\s*(?:(?:是|属于|仍(?:然)?|已经?|现在)\s*)?(?:不再阻塞|不阻塞|非阻塞)|(?:不再阻塞|不阻塞|非阻塞)\s*(?:的是|为|针对|就)?\s*(?:产品取舍|延期(?:决定|处理)?|范围(?:说明|决定|取舍)?|单独处理(?:方案)?|另开(?:处理|事项)?|P[01]\s*(?:问题|finding)|(?:当前|这个|此|该)?\s*finding)|\b(?:(?:this|that|the|current|proposed|reported|P[01])\s+)?(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+concern)\b\s+(?:(?:is|remains?)\s+)?(?:(?:clearly|explicitly)\s+)?(?:non-?blocking|not\s+a\s+blocker)\b|\b(?:non-?blocking|not\s+a\s+blocker)\b\s+(?:for|as\s+to|with\s+respect\s+to)\s+(?:(?:this|that|the|current|proposed|reported|P[01])\s+)?(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+concern)\b/i

const REVIEWER_SCOPED_NON_BLOCKING_UNCERTAINTY_PATTERN =
  /(?:可能|也许|或许|大概|未必|不确定)|\b(?:may|might|could|can|probably|possibly|perhaps|maybe|likely|arguably)\b/i

const REVIEWER_SCOPED_NON_BLOCKING_TECHNICAL_SUBJECT_PATTERN =
  /(?:\b(?:ci|tests?|test\s+failure|build|checks?|jobs?|deployment|general\s+risk)\b[^.。！？!?；;\n]{0,64}\b(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+concern)\b[^.。！？!?；;\n]{0,32}\b(?:non-?blocking|not\s+a\s+blocker)\b|\b(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+concern)\b(?:['’]s)?[^.。！？!?；;\n]{0,32}\b(?:ci|tests?|test\s+failure|build|checks?|jobs?|deployment|general\s+risk)\b[^.。！？!?；;\n]{0,32}\b(?:non-?blocking|not\s+a\s+blocker)\b)|(?:CI|测试(?:失败)?|构建|检查|任务|部署|一般风险)[^。！？!?；;\n]{0,32}(?:产品取舍|延期|范围|finding)[^。！？!?；;\n]{0,24}(?:不再阻塞|不阻塞|非阻塞)|(?:产品取舍|延期|范围|finding)[^。！？!?；;\n]{0,24}(?:CI|测试(?:失败)?|构建|检查|任务|部署|一般风险)[^。！？!?；;\n]{0,24}(?:不再阻塞|不阻塞|非阻塞)/i

const REVIEWER_SCOPED_NON_BLOCKING_LIMITATION_PATTERN =
  /\b(?:non-?blocking|not\s+a\s+blocker)\b[^.。！？!?；;\n]{0,32}(?:\b(?:only|solely)?\s*(?:in|for|within|with\s+respect\s+to)\s+(?:ci|tests?|build|checks?|jobs?|deployment)(?:\s+(?:only|alone))?\b|\blimited\s+to\s+(?:ci|tests?|build|checks?|jobs?|deployment)\b|\b(?:only\s+)?if\b[^.。！？!?；;\n]{0,24}\b(?:ci|tests?|build|checks?|jobs?|deployment)\b|\b(?:subject\s+to|provided(?:\s+that)?)\b[^.。！？!?；;\n]{0,24}\b(?:ci|tests?|build|checks?|jobs?|deployment)\b)|(?:不再阻塞|不阻塞|非阻塞)[^。！？!?；;\n]{0,24}(?:(?:仅|只)?(?:限)?(?:在|对|针对|就)\s*(?:CI|测试|构建|检查|任务|部署)|(?:仅限|只限)\s*(?:CI|测试|构建|检查|任务|部署)|(?:仅当|只有|前提是|取决于)[^。！？!?；;\n]{0,16}(?:CI|测试|构建|检查|任务|部署))/i

const REVIEWER_SCOPED_NON_BLOCKING_REJECTION_PATTERN =
  /(?:不同意|反对|拒绝|不认可|不赞成)[^。！？!?；;\n]{0,72}(?:(?:(?:当前|这个|此|该)?\s*finding|产品取舍|延期|范围决定)[^。！？!?；;\n]{0,32}(?:不再阻塞|不阻塞|非阻塞)|(?:不再阻塞|不阻塞|非阻塞)[^。！？!?；;\n]{0,32}(?:(?:当前|这个|此|该)?\s*finding|产品取舍|延期|范围决定))|\b(?:disagree(?:s|d|ing)?|reject(?:s|ed|ing)?|oppos(?:e|es|ed|ing)|object(?:s|ed|ing)?\s+to)\b[^.。！？!?；;\n]{0,96}\b(?:(?:(?:this|that|the|current|proposed|reported|P[01])\s+)?(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?)\b[^.。！？!?；;\n]{0,32}\b(?:non-?blocking|not\s+a\s+blocker)\b|(?:non-?blocking|not\s+a\s+blocker)\b[^.。！？!?；;\n]{0,32}\b(?:(?:this|that|the|current|proposed|reported|P[01])\s+)?(?:finding|deferral|product\s+trade-?off|scope(?:\s+decision)?)\b)/i

const NEGATED_REVIEWER_SCOPED_NON_BLOCKING_REJECTION_PATTERN =
  /(?:不|并不|并非|不是)\s*(?:不同意|反对|拒绝|不认可|不赞成)|\b(?:(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t|never)\s+(?:disagree|oppose|reject|object)|(?:have|has|had)\s+no\s+(?:objection|opposition))\b/i

const REVIEWER_NON_BLOCKING_LIMITATION_FRAGMENT_PATTERN =
  /^(?:\b(?:only|solely)?\s*(?:in|for|within|with\s+respect\s+to)\s+(?:ci|tests?|build|checks?|jobs?|deployment)(?:\s+(?:only|alone))?\b|\blimited\s+to\s+(?:ci|tests?|build|checks?|jobs?|deployment)\b|\b(?:only\s+)?if\b[^.。！？!?；;\n]{0,24}\b(?:ci|tests?|build|checks?|jobs?|deployment)\b|\b(?:subject\s+to|provided(?:\s+that)?)\b[^.。！？!?；;\n]{0,24}\b(?:ci|tests?|build|checks?|jobs?|deployment)\b|(?:仅|只)?(?:限)?(?:在|对|针对|就)\s*(?:CI|测试|构建|检查|任务|部署)|(?:仅限|只限)\s*(?:CI|测试|构建|检查|任务|部署)|(?:仅当|只有|前提是|取决于)[^。！？!?；;\n]{0,16}(?:CI|测试|构建|检查|任务|部署))/i

const REVIEWER_FIXED_ACCEPTANCE_PATTERN =
  /(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)(?:修复|处理|解决)|\b(?:confirm(?:ed)?|verif(?:y|ied))\b[^.。！？!?\n]{0,32}\b(?:fixed|addressed|resolved)\b/i

const NEGATED_REVIEWER_FIXED_CONFIRMATION_PATTERN =
  /(?:确认|核实)[^。！？!?；;\n]{0,24}(?:仍(?:然)?|还)?(?:未|尚未|没有|并未|还没)(?:完全)?(?:修复|处理|解决)|\b(?:confirm(?:s|ed|ing)?|verif(?:y|ies|ied|ying))\b[^.。！？!?；;\n]{0,48}\b(?:(?:not|never)\s+(?!only\b)(?:(?:yet|still|fully|completely|actually)\s+)*(?:been\s+)?(?:fixed|addressed|resolved)|(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?!only\b)(?:(?:yet|still|fully|completely|actually)\s+)*(?:fixed|addressed|resolved)|(?:hasn['’]t|haven['’]t|hadn['’]t)\s+been\s+(?:fixed|addressed|resolved)|(?:has|have|had)\s+yet\s+to\s+be\s+(?:fixed|addressed|resolved)|no\s+longer\s+(?:fixed|addressed|resolved)|(?:is|are|was|were|remain(?:s|ed|ing)?)\s+(?:(?:still|yet|currently)\s+)?(?:unfixed|unaddressed|unresolved)|(?:is|are|was|were|remain(?:s|ed|ing)?)\s+(?:(?:still|currently)\s+)?(?:far\s+from|anything\s+but)\s+(?:fixed|addressed|resolved))\b/i

const REVIEWER_DEFERRAL_ACCEPTANCE_PATTERN =
  /(?:接受|同意)[^。！？!?\n]{0,32}(?:延期|取舍|范围(?:说明)?|另开|后续处理|单独处理)|可以另开|\b(?:accept(?:ed)?|agree(?:d)?)\b[^.。！？!?\n]{0,40}\b(?:deferral|trade-?off|scope|out\s+of\s+scope|follow-?up|separate\s+(?:concern|issue|pr))\b|\bmakes?\s+sense\b[^.。！？!?\n]{0,40}\b(?:scope|separate|follow-?up)\b|\bkeep\s+the\s+scope\s+tight\b/i

const REVIEWER_REJECTION_PATTERN =
  /(?:不接受|不同意|不理解|撤回(?:同意|接受|批准)|不再(?:同意|接受)|(?:不能|无法|不可|尚未|未能)\s*(?:确认|核实)[^。！？!?\n]{0,24}(?:已|已经)?(?:修复|处理|解决)|仍(?:然)?阻塞|还是阻塞|不能另开|不可另开|(?:不能|不可|不得)\s*单独处理|(?:不认为|不能认为|并非|不是)[^。！？!?\n]{0,24}(?:非阻塞|不阻塞)|(?:必须|需要|应该|应当)\s*在本\s*PR\s*(?:修复|处理|解决)|合并前(?:仍需|请|必须)?[^。！？!?\n]{0,24}(?:修复|处理|解决)|仍需修复)|\b(?:do\s+not|don't|cannot|can't|won't)\s+(?:accept|agree|withdraw|confirm|verify)\b|\b(?:i\s+am|i['’]m|we\s+are|we['’]re|(?:you|they)\s+are|(?:you|they)['’]re|(?:he|she)\s+is)\s+not\s+(?:accepting|agreeing)\b|\b(?:have|has|had)\s+not\s+(?:confirmed|verified)\b|\b(?:do\s+not|don't|cannot|can't|won't)\s+(?:consider|regard|treat|view)\b[^.。！？!?\n]{0,48}\bnon-?blocking\b|\b(?:is|are)\s+not\s+non-?blocking\b|\b(?:have|has|had)\s+not\s+(?:accepted|agreed)\b|\b(?:haven['’]t|hasn['’]t|hadn['’]t)\s+(?:accepted|agreed)\b|\bno\s+longer\s+(?:accept|agree)\b|\b(?:withdraw|retract)(?:ing|s|ed)?\s+(?:my|our|the|that)?\s*(?:acceptance|agreement|approval)\b|\b(?:is\s+not|isn't|not)\s+(?:a\s+)?separate\s+(?:concern|issue|pr)\b|\b(?:address|fix|resolve)\s+(?:it|this|the\s+(?:issue|finding))\s+in\s+this\s+(?:pr|pull\s+request)\b|\b(?:please\s+)?(?:address|fix|resolve)\s+(?:it|this|the\s+(?:issue|finding))\s+before\s+(?:merge|merging)\b|\b(?:still|remains?)\s+(?:a\s+)?blocker\b|\b(?:still\s+needs?\s+(?:work|to\s+be\s+fixed)|needs?\s+to\s+be\s+fixed|must\s+be\s+fixed)\b|\b(?:but|however)\b[^.。！？!?\n]{0,80}\b(?:still\s+needs?\s+to|needs?\s+to\s+be\s+fixed|must\s+be\s+fixed|before\s+merge|block(?:er|ing)?)\b/i

const MANDATORY_REVIEWER_NON_ACCEPTANCE_PATTERN =
  /(?:不得|不应|不能|必须不)\s*(?:接受|同意|批准|认可)|\b(?:(?:(?:i|we|you|they|reviewers?|maintainers?|the\s+team)\s+)?(?:(?:must|shall)\s+not|mustn['’]t|shan['’]t)\s+(?:accept|agree|approve|endorse)\b|(?:deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+(?:concern|issue|pr))\b[^.。！？!?；;\n]{0,40}\b(?:(?:must|shall)\s+not|mustn['’]t|shan['’]t)\s+be\s+(?:accepted|approved|endorsed)\b|(?:it|this|that)\s+(?:(?:must|shall)\s+not|mustn['’]t|shan['’]t)\s+be\s+(?:accepted|approved|endorsed)\b[^.。！？!?；;\n]{0,40}\b(?:as\s+(?:a\s+)?(?:deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+(?:concern|issue|pr))|(?:deferral|product\s+trade-?off|scope(?:\s+decision)?|separate\s+(?:concern|issue|pr)))\b)/i

const QUALIFIED_REVIEWER_NON_ACCEPTANCE_PATTERN =
  /\b(?:(?:i\s+am|i['’]m|we\s+are|we['’]re|(?:you|they)\s+are|(?:you|they)['’]re|(?:he|she)\s+is)\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:unwilling|unable)\s+to\s+(?:accept|agree)|(?:i\s+am|i['’]m|we\s+are|we['’]re|(?:you|they)\s+are|(?:you|they)['’]re|(?:he|she)\s+is)\s+not\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:(?:willing|ready|prepared|able)\s+to\s+(?:accept|agree)|(?:accepting|agreeing)|in\s+(?:a\s+)?position\s+to\s+(?:accept|agree))|(?:do\s+not|don['’]t|cannot|can['’]t|will\s+not|won['’]t)\s+(?:(?:currently|yet|now|at\s+this\s+time)\s+)?(?:accept|agree))\b/i

const QUALIFIED_REVIEWER_FIXED_NON_CONFIRMATION_PATTERN =
  /\b(?:(?:i\s+am|i['’]m|we\s+are|we['’]re|(?:you|they)\s+are|(?:you|they)['’]re|(?:he|she)\s+is)\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:(?:unable|unprepared|unwilling|hesitant|reluctant)\s+to|not\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:ready|prepared|able|willing)\s+to|not\s+in\s+(?:a\s+)?position\s+to)\s+(?:confirm|verify)|(?:i\s+am|i['’]m|we\s+are|we['’]re|(?:you|they)\s+are|(?:you|they)['’]re|(?:he|she)\s+is)\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:not\s+comfortable|uncomfortable)\s+(?:confirming|verifying)|(?:(?:we|you|they)\s+aren['’]t|(?:he|she)\s+isn['’]t)\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:ready|prepared|able|willing)\s+to\s+(?:confirm|verify)|(?:i|we|you|they|he|she)\s+(?:may|might|could|would)\s+(?:(?:be\s+(?:unable|unprepared|unwilling|hesitant|reluctant|in\s+no\s+position)|not\s+be\s+(?:ready|prepared|able|willing))\s+to\s+)(?:confirm|verify)|(?:i|we|you|they|he|she)\s+(?:(?:(?:should|must|shall|would|will|may|might|could)\s+not|shouldn['’]t|mustn['’]t|shan['’]t|wouldn['’]t|won['’]t|mightn['’]t|couldn['’]t)|cannot|can['’]t|do\s+not|don['’]t)\s+(?:(?:currently|yet|still|now|at\s+this\s+time)\s+)?(?:confirm|verify))\b[^.。！？!?；;\n]{0,64}\b(?:fixed|addressed|resolved)\b/i

const PAST_REVIEWER_NON_ACCEPTANCE_PATTERN =
  /\b(?:i|we|you|they|he|she)\s+(?:(?:(?:did\s+not|didn['’]t)\s+(?:accept|agree))|(?:never\s+(?:accept(?:ed)?|agree(?:d)?))|(?:(?:have|has|had)\s+never\s+(?:accepted|agreed))|(?:(?:was|were)\s+not\s+(?:accepting|agreeing)))\b/i

const INDIRECT_REVIEWER_NON_ACCEPTANCE_PATTERN =
  /\b(?:(?:i|we)\s+(?:(?:do|does)\s+not|don['’]t|doesn['’]t)\s+(?:think|believe|feel)\b[^.。！？!?；;\n]{0,64}\b(?:(?:(?:i|we|this|that|it)\s+)?(?:(?:should|can|could|would|will|may|might)\s+(?!(?:not|never)\b)(?:be\s+)?)?(?:accept(?:ed)?|agree(?:d)?)|(?:accepting|agreeing))|(?:i|we)\s+(?:(?:(?:do|does)\s+not|don['’]t|doesn['’]t|cannot|can['’]t)\s+see\s+(?:how|why)|(?:am|are)\s+not\s+convinced)\b[^.。！？!?；;\n]{0,64}\b(?:accept|agree)|(?:(?:there\s+is|there['’]s)|(?:i|we)\s+have)\s+no\s+(?:basis|reason|grounds?)\s+to\s+(?:accept|agree)|(?:i|we)\s+(?:(?:would|could|should|may|might)\s+not|wouldn['’]t|couldn['’]t|shouldn['’]t|mightn['’]t)\s+(?:(?:currently|yet|now|necessarily)\s+)?(?:(?:be\s+)?(?:willing|ready|prepared|able)\s+to\s+)?(?:accept|agree)|(?:i|we)\s+(?:would|could|can|may|might)\s+only\s+(?:accept|agree)|(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+(?:not\s+(?:sure|certain|comfortable)|hesitant|reluctant)\b[^.。！？!?；;\n]{0,48}\b(?:accept|agree)|(?:i|we)\s+(?:would\s+)?hesitate\s+to\s+(?:accept|agree)|(?:i|we)\s+(?:(?:can|could|would|may|might)\s+)?(?:accept|agree)\b[^.。！？!?；;\n]{0,64}\b(?:only\s+if|if\s+(?!(?:useful|helpful|needed|desired|necessary)\b)|unless|provided(?:\s+that)?|as\s+long\s+as|once|after|when|subject\s+to|pending)\b|(?:if|unless|provided(?:\s+that)?|as\s+long\s+as|once|after|when|subject\s+to|pending)\b[^.。！？!?；;\n]{0,64}\b(?:i|we)\s+(?:(?:can|could|would|may|might)\s+)?(?:accept|agree))\b/i

const REVIEWER_SEPARATE_HANDLING_NON_ACCEPTANCE_PATTERN =
  /\b(?:(?:(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+(?:not\s+(?:comfortable|sure|certain)|uncomfortable|uneasy|hesitant|reluctant)|(?:i|we)\s+(?:would|could|may|might)\s+not\s+be\s+comfortable)\s+(?:(?:with|about|to)\s+)?(?:treat(?:ing)?|handl(?:e|ing)|regard(?:ing)?|view(?:ing)?)[^.。！？!?；;\n]{0,48}\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|separately)|(?:(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+(?:only\s+)?comfortable|(?:i|we)\s+(?:(?:would|could|can|may|might)\s+)?(?:only\s+)?be\s+comfortable)\s+(?:(?:with|about)\s+)?(?:treating|handling|regarding|viewing)[^.。！？!?；;\n]{0,48}\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|separately)[^.。！？!?；;\n]{0,48}\b(?:only\s+if|if\s+(?!(?:useful|helpful|needed|desired|necessary)\b)|unless|provided(?:\s+that)?|as\s+long\s+as|once|after|when|subject\s+to|pending)\b)/i

const REVIEWER_SEPARATE_HANDLING_SUPPORT_REJECTION_PATTERN =
  /(?:不支持|无法支持|不能支持|不再支持|不批准|无法批准|不能批准|不再批准|不认可|不再认可)[^。！？!?；;\n]{0,64}(?:单独处理|独立(?:问题|事项|处理))|(?:支持|赞成|批准|认可)[^。！？!?；;\n]{0,48}(?:不|不要|无需|不应)(?:再)?[^。！？!?；;\n]{0,32}(?:单独处理|作为独立(?:问题|事项)处理)|\b(?:i|we)\s+(?:(?:(?:do\s+not|don['’]t|cannot|can['’]t|will\s+not|won['’]t)\s+(?:(?:currently|fully|yet)\s+)?(?:continue\s+to\s+)?(?:support|approve|endorse))|(?:no\s+longer\s+(?:support|approve|endorse))|(?:(?:am|are)\s+(?:not\s+(?:willing|able|ready)|unable|unwilling)\s+to\s+(?:support|approve|endorse)))[^.。！？!?；;\n]{0,64}\b(?:treat(?:ing)?|handl(?:e|ing)|regard(?:ing)?|view(?:ing)?)[^.。！？!?；;\n]{0,48}\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|separately)\b|\b(?:i|we)\s+(?:support|endorse|approve)[^.。！？!?；;\n]{0,48}\b(?:not\s+to|not|against)\s+(?:treat(?:ing)?|handl(?:e|ing)|regard(?:ing)?|view(?:ing)?)[^.。！？!?；;\n]{0,48}\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|separately)\b/i

const REVIEWER_SEPARATE_HANDLING_ACCEPTANCE_PATTERN =
  /(?:不反对|支持|赞成)[^。！？!?；;\n]{0,64}(?:单独处理|独立(?:问题|事项|处理))|(?:这|此)(?:是|属于)(?:一个)?独立(?:问题|事项)|\b(?:(?:i|we)\s+(?:support|endorse)[^.。！？!?；;\n]{0,64}|(?:(?:i\s+am|i['’]m|we\s+are|we['’]re)\s+(?:comfortable|willing|ready|prepared|not\s+uncomfortable)|(?:i|we)\s+(?:would|could|can|may|might)\s+be\s+comfortable)\s+(?:(?:with|about|to)\s+)?(?:treat(?:ing)?|handl(?:e|ing)|regard(?:ing)?|view(?:ing)?)[^.。！？!?；;\n]{0,48}|(?:i|we)\s+(?:(?:(?:do\s+not|don['’]t|cannot|can['’]t)\s+(?:object|oppose|disagree))|(?:(?:am|are)\s+not\s+(?:against|opposed))|(?:have\s+no\s+opposition))[^.。！？!?；;\n]{0,64})\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|(?:treat(?:ing)?|handl(?:e|ing)|regard(?:ing)?|view(?:ing)?)[^.。！？!?；;\n]{0,32}\b(?:as\s+(?:a\s+)?separate\s+(?:concern|issue|pr)|separately)|separately)\b|\b(?:this|that|it)\s+(?:is|['’]s)\s+(?:a\s+)?separate\s+(?:concern|issue)\b/i

const REVIEWER_SEPARATE_CONCERN_REJECTION_PATTERN =
  /(?:反对|不赞成|不支持)[^。！？!?\n]{0,80}(?:延期|取舍|范围|另开|后续处理|单独处理|独立(?:问题|事项|处理))|\b(?:disagree(?:s|d|ing)?(?:\s+(?:that|with))?|oppos(?:e|es|ed|ing)|opposition\s+to|(?:am|is|are|was|were)\s+against|reject(?:s|ed|ing)?|object(?:s|ed|ing)?\s+to|(?:refus(?:e|es|ed|ing)|declin(?:e|es|ed|ing))\s+to\s+(?:accept|agree)|(?:refusal|declination)\s+to\s+(?:accept|agree))\b[^.。！？!?\n]{0,80}\b(?:deferral|trade-?off|scope|out\s+of\s+scope|follow-?up|separate\s+(?:concern|issue|pr|handling|treatment)|(?:treat(?:ed|ing)?|handl(?:e|ing)|address(?:ed|ing)?)\b[^.。！？!?\n]{0,24}\bseparately)\b/i

const NEGATED_REVIEWER_SEPARATE_CONCERN_REJECTION_PATTERN =
  /(?:不|并不|并非|不是)\s*反对|\b(?:no\s+opposition\s+to|(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t|never)\s+(?:disagree|oppose|reject|object|refuse|decline)|(?:am|is|are)\s+not\s+(?:against|disagreeing|opposed|opposing|refusing|declining))\b/i

const NEGATED_REVIEWER_WITHDRAWAL_PATTERN =
  /\b(?:(?:have|has|had)\s+not|haven['’]t|hasn['’]t|hadn['’]t)\s+(?:withdrawn|retracted)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:(?:do|does|did)\s+not|don['’]t|doesn['’]t|didn['’]t)\s+(?:withdraw|retract)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:(?:(?:will|shall|would)\s+(?:not|never)|won['’]t|shan['’]t|wouldn['’]t)\s+(?:(?:withdraw|retract)|be\s+(?:withdrawing|retracting)))\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:(?:i['’]m|(?:we|you|they)['’]re|(?:he|she|it)['’]s|am|is|are)\s+not|(?:isn['’]t|aren['’]t))\s+(?:withdrawing|retracting)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:am|is|are)\s+not\s+(?:going|planning)\s+to\s+(?:withdraw|retract)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:(?:do|does)\s+not|don['’]t|doesn['’]t)\s+(?:intend|plan)\s+to\s+(?:withdraw|retract)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:have|has)\s+no\s+(?:intention\s+of\s+(?:withdrawing|retracting)|plans?\s+to\s+(?:withdraw|retract))\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b|\b(?:blocker|objection|concern|request\s+for\s+changes)\b[^.。！？!?\n]{0,40}\b(?:(?:has|had)\s+not|hasn['’]t|hadn['’]t)\s+been\s+(?:withdrawn|retracted)\b/i

const REVIEWER_WITHDRAWAL_REFUSAL_PATTERN =
  /(?:拒绝|不愿意?|不肯|无法|不能|尚不愿意?|还不愿意?)\s*(?:撤回|收回)\s*(?:阻止|阻塞|反对|异议|变更请求)|\b(?:(?:i|we)\s+(?:refus(?:e|ed)|declin(?:e|ed))\s+to|(?:i|we)(?:(?:['’]ve|\s+have|\s+had))\s+(?:refused|declined)\s+to|(?:i\s+(?:am|['’]m)|we\s+(?:are|['’]re))\s+(?:refusing|declining|unwilling|unable|not\s+(?:willing|ready|prepared))\s+to)\s+(?:withdraw|retract)\b[^.。！？!?\n]{0,40}\b(?:blocker|objection|concern|request\s+for\s+changes)\b/i

const REVIEWER_ACCEPTANCE_UNCERTAINTY_PATTERN =
  /[?？]|(?:是否(?:可以)?|是不是|能否|可否|能不能|可不可以|要不要)[^。！？!?\n]{0,32}(?:接受|同意|另开|单独处理|不阻塞|非阻塞)|(?:吗|么|呢|吧)(?:$|[\s。！？!?，,；;])|\b(?:can|could|would|should|may|might|will|do|does|did)\s+(?!(?:not|never)\b)(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:accept|agree|consider|regard|treat)\b|\b(?:are|is)\s+(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:(?:accept|agree|consider|regard|treat)ing|(?:willing|able|ready|prepared)\s+to\s+(?:accept|agree|consider|regard|treat))\b|\bwhether\s+(?:i|we|you|they|he|she|maintainers?|reviewers?|the\s+team|(?:the\s+)?@?[a-z][\w.-]*(?:\s+[a-z][\w.-]*){0,2})\s+(?:accept|agree|consider|regard|treat)s?\b|\b(?:i|we)\s+(?:could|would|may|might)\s+(?:accept|agree|consider|regard|treat)\b|\b(?:maybe|perhaps|possibly)\b[^.。！？!?\n]{0,40}\b(?:accept|agree|consider|regard|treat)\b/i

const REVIEWER_PROSPECTIVE_ACCEPTANCE_PATTERN =
  /(?:我|我们)(?:目前|现在)?\s*(?:计划|打算|希望|期望|预计|准备|想要|将(?:会)?|会(?:在[^。！？!?；;\n]{0,16})?|以后会|之后会|届时会)[^。！？!?；;\n]{0,48}(?:接受|同意|确认|核实|撤回|收回|支持|赞成|不再阻塞|不阻塞|非阻塞)|\b(?:i|we)\s+(?:(?:plan|intend|hope|expect|aim|wish|want)\b|(?:am|are)\s+(?:planning|intending|hoping|expecting|aiming|wishing)\b|(?:will|shall)\s+(?!(?:not|never)\b)|(?:am|are)\s+going\s+to\b|would\s+like\s+to\b)[^.。！？!?；;\n]{0,64}\b(?:accept|agree|confirm|verify|withdraw|retract|support|endorse|non-?blocking|not\s+a\s+blocker)\b/i

const OWNER_PRODUCT_DECISION_WITHDRAWAL_PATTERN =
  /(?:(?:撤回|收回|取消|作废)[^。！？!?；;\n]{0,40}(?:产品取舍|产品决定|产品决策|延期|范围决定|单独处理)[^。！？!?；;\n]{0,32}(?:放行|批准|同意|授权)|(?:撤回|收回|取消|作废)[^。！？!?；;\n]{0,32}(?:放行|批准|同意|授权)[^。！？!?；;\n]{0,40}(?:产品取舍|产品决定|产品决策|延期|范围决定|单独处理)|不再(?:放行|批准|同意|授权)[^。！？!?；;\n]{0,40}(?:产品取舍|产品决定|产品决策|延期|范围决定|单独处理))|\b(?:(?:withdraw|retract|revoke|rescind|cancel)(?:s|ed|ing)?\b[^.。！？!?；;\n]{0,48}\b(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b[^.。！？!?；;\n]{0,48}\b(?:deferral|product\s+(?:decision|trade-?off)|scope\s+decision|separate\s+(?:concern|handling))\b|(?:withdraw|retract|revoke|rescind|cancel)(?:s|ed|ing)?\b[^.。！？!?；;\n]{0,48}\b(?:deferral|product\s+(?:decision|trade-?off)|scope\s+decision|separate\s+(?:concern|handling))\b[^.。！？!?；;\n]{0,48}\b(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b|no\s+longer\s+(?:approve|authorize|authorise|sign\s+off\s+on|give\s+the\s+go-?ahead\s+for)\b[^.。！？!?；;\n]{0,48}\b(?:deferral|product\s+(?:decision|trade-?off)|scope\s+decision|separate\s+(?:concern|handling))\b|\b(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b[^.。！？!?；;\n]{0,48}\b(?:deferral|product\s+(?:decision|trade-?off)|scope\s+decision|separate\s+(?:concern|handling))\b[^.。！？!?；;\n]{0,24}\b(?:is|was|has\s+been|had\s+been)\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)\b)/i

const OWNER_GENERIC_APPROVAL_WITHDRAWAL_PATTERN =
  /(?:我|我们)?(?:已|已经|现在)?\s*(?:撤回|收回|取消|作废)\s*(?:了\s*)?(?:(?:我|我们)的|该|这个)?\s*(?:放行|批准|同意|授权)|(?:(?:我|我们)的|该|这个)?\s*(?:放行|批准|同意|授权)\s*(?:已|已经)?(?:被)?\s*(?:撤回|收回|取消|作废)|\b(?:(?:i|we)\s+(?:(?:have|['’]ve)\s+)?(?:withdraw|withdrew|withdrawn|retract(?:ed)?|revoke(?:d)?|rescind(?:ed)?|cancel(?:led|ed)?)\s+(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)|(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\s+(?:is|was|has\s+been|had\s+been)\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled))\b/i

const OWNER_LATE_APPROVAL_WITHDRAWAL_PATTERN =
  /(?:(?:(?:我|我们)的|该|这个)?\s*(?:放行|批准|同意|授权)[^。！？!?；;\n]{0,24}(?:现在|如今|今天|目前|现已)(?:已|已经)?(?:被)?\s*(?:撤回|收回|取消|作废)|\b(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b[^.。！？!?；;\n]{0,48}\b(?:now|today|currently)\s+(?:(?:(?:has|had)\s+been|is|was)\s+)?(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)\b)/i

const NEGATED_OWNER_APPROVAL_WITHDRAWAL_PATTERN =
  /(?:我|我们)(?:并|也)?(?:不|没有|没|不会|不能|无法|拒绝|不愿意?)\s*(?:撤回|收回|取消|作废)[^。！？!?；;\n]{0,24}(?:放行|批准|同意|授权)|(?:(?:我|我们)的|该|这个)?\s*(?:放行|批准|同意|授权)[^。！？!?；;\n]{0,16}(?:未|没有|没|并未|不会)(?:被)?\s*(?:撤回|收回|取消|作废)|\b(?:(?:i|we)\s+(?:(?:(?:do|did|will|would)\s+not|don['’]t|didn['’]t|won['’]t|wouldn['’]t|cannot|can['’]t)\s+(?:withdraw|retract|revoke|rescind|cancel)|(?:refuse|decline)\s+to\s+(?:withdraw|retract|revoke|rescind|cancel)|(?:have|has|had)\s+not\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)|(?:haven['’]t|hasn['’]t|hadn['’]t)\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled))\b[^.。！？!?；;\n]{0,32}\b(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b|(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\s+(?:(?:is|was)\s+not\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)|(?:has|had)\s+not\s+been\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)|(?:hasn['’]t|hadn['’]t)\s+been\s+(?:withdrawn|retracted|revoked|rescinded|cancelled|canceled)))\b/i

const PENDING_OWNER_APPROVAL_WITHDRAWAL_PATTERN =
  /(?:如果|若|只要|除非|等到|待|当|一旦)[^。！？!?；;\n]{0,48}(?:我|我们)?[^。！？!?；;\n]{0,24}(?:撤回|收回|取消|作废)[^。！？!?；;\n]{0,24}(?:放行|批准|同意|授权)|(?:我|我们)(?:将(?:会)?|会|可能|也许|计划|打算|准备|希望|考虑)[^。！？!?；;\n]{0,32}(?:撤回|收回|取消|作废)[^。！？!?；;\n]{0,24}(?:放行|批准|同意|授权)|\b(?:(?:if|unless|when|once|after|before|subject\s+to|pending)\b[^.。！？!?；;\n]{0,64}\b(?:i|we)\s+(?:will\s+|would\s+|may\s+|might\s+|could\s+)?(?:withdraw|retract|revoke|rescind|cancel)\b[^.。！？!?；;\n]{0,32}\b(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b|(?:i|we)\s+(?:(?:will|would|may|might|could)\s+(?!not\b)|(?:plan|intend|hope|expect)\s+to\s+|(?:am|are)\s+going\s+to\s+)(?:withdraw|retract|revoke|rescind|cancel)\b[^.。！？!?；;\n]{0,32}\b(?:my|our)\s+(?:approval|authorization|authorisation|sign-?off|go-?ahead)\b)/i

const FINDING_FIXED_PATTERN =
  /(?:已|已经)(?:修复|处理|解决|改好)|(?:已|已经)?补(?:上|了)?(?:回归)?测试|\b(?:fixed|addressed|resolved|implemented)(?:\s+this|\s+it|\s+the\s+(?:issue|finding))?\b/i

const NEGATED_FINDING_FIXED_PATTERN =
  /(?:未|尚未|没有|并未|还没)(?:修复|处理|解决|改好|补(?:上|回归)?测试)|\b(?:not|isn't|is\s+not|wasn't|was\s+not|aren't|are\s+not|weren't|were\s+not|haven't|have\s+not|hasn't|has\s+not|hadn't|had\s+not|never)\s+(?:been\s+)?(?:fixed|addressed|resolved|implemented)\b/i

function sameHead(value, headOid) {
  return String(value || '').toLowerCase() === String(headOid || '').toLowerCase()
}

function eventTime(value) {
  return Date.parse(value || 0) || 0
}

function commentTime(comment) {
  return eventTime(comment?.updated_at || comment?.created_at)
}

function dispositionTime(comment) {
  return eventTime(comment?.created_at)
}

function authorDispositionKind(body) {
  if (isProductDeferral(body)) return 'deferral'
  if (isFindingFixRetraction(body)) return 'fix-retracted'
  if (isFindingFixedClaim(body)) return 'fixed'
  return null
}

function compactEditText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')
}

function editDistanceWithin(left, right, limit) {
  if (Math.abs(left.length - right.length) > limit) return false
  const overflow = limit + 1
  let previous = new Map()
  for (let index = 0; index <= Math.min(right.length, limit); index++) {
    previous.set(index, index)
  }
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = new Map()
    const start = Math.max(0, leftIndex - limit)
    const end = Math.min(right.length, leftIndex + limit)
    let rowMinimum = overflow
    for (let rightIndex = start; rightIndex <= end; rightIndex++) {
      const value = rightIndex === 0
        ? leftIndex
        : Math.min(
          (previous.get(rightIndex) ?? overflow) + 1,
          (current.get(rightIndex - 1) ?? overflow) + 1,
          (previous.get(rightIndex - 1) ?? overflow)
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        )
      if (value <= limit) current.set(rightIndex, value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > limit) return false
    previous = current
  }
  return (previous.get(right.length) ?? overflow) <= limit
}

function isCosmeticEdit(left, right) {
  const compactLeft = compactEditText(left)
  const compactRight = compactEditText(right)
  if (compactLeft === compactRight) return true
  const limit = Math.min(6, Math.max(2, Math.floor(Math.max(compactLeft.length, compactRight.length) * 0.02)))
  return editDistanceWithin(compactLeft, compactRight, limit)
}

function patchEdit(value) {
  const lines = String(value || '').split('\n')
  const before = []
  const after = []
  for (const line of lines) {
    if (/^-(?!---)/.test(line)) before.push(line.slice(1))
    else if (/^\+(?!\+\+)/.test(line)) after.push(line.slice(1))
  }
  if (before.length === 0 && after.length === 0) return null
  return {
    type: 'patch',
    before: before.join('\n'),
    after: after.join('\n'),
    complete: before.length > 0 && after.length > 0,
  }
}

function editEntries(comment) {
  return (comment?.edits || []).map((edit) => {
    const body = edit?.body == null ? '' : String(edit.body)
    if (body) return { type: 'body', body }
    const diff = edit?.diff == null ? '' : String(edit.diff)
    if (!diff) return { type: 'empty' }
    return patchEdit(diff) || { type: 'body', body: diff, opaque: true }
  })
}

function editDispositionTexts(comment) {
  return editEntries(comment).flatMap((entry) => {
    if (entry.type === 'body') return [entry.body]
    if (entry.type === 'patch') return [entry.before, entry.after].filter(Boolean)
    return []
  })
}

function hasEditEvidence(comment) {
  return comment?.edits_complete === false
    || (Array.isArray(comment?.edits) && comment.edits.length > 0)
}

function hasOpaqueDispositionEdit(comment) {
  const createdAt = dispositionTime(comment)
  const updatedAt = commentTime(comment)
  if (!updatedAt || updatedAt < createdAt
    || (updatedAt === createdAt && !hasEditEvidence(comment))) return false
  if (comment?.edits_complete === false) return true
  const entries = editEntries(comment)
  if (entries.length === 0) return true
  return entries.some((entry) => {
    if (entry.type === 'empty') return true
    if (entry.type === 'patch') {
      return !entry.complete
    }
    if (entry.opaque && authorDispositionKind(comment.body)) return true
    const entryKind = authorDispositionKind(entry.body)
    if (entryKind) return false
    return isLikelyPatchFragment(entry.body, comment.body, authorDispositionKind)
  })
}

function isLikelyPatchFragment(value, currentBody, dispositionKind) {
  if (dispositionKind(value)) return false
  const compactValue = compactEditText(value)
  const compactCurrent = compactEditText(currentBody)
  return compactValue.length < Math.max(8, Math.floor(compactCurrent.length * 0.5))
}

function hasSemanticDispositionEdit(comment, dispositionKind) {
  const createdAt = dispositionTime(comment)
  const updatedAt = commentTime(comment)
  if (!updatedAt || updatedAt < createdAt
    || (updatedAt === createdAt && !hasEditEvidence(comment))) return false
  if (comment?.edits_complete === false) return true
  const currentBody = String(comment?.body || '')
  const currentKind = dispositionKind(currentBody)
  const entries = editEntries(comment)
  if (entries.length === 0) return true
  return entries.some((entry) => {
    if (entry.type === 'empty') return true
    if (entry.type === 'patch') {
      const beforeKind = dispositionKind(entry.before)
      const afterKind = dispositionKind(entry.after)
      if (beforeKind !== afterKind && (beforeKind || afterKind)) return true
      if (beforeKind && afterKind) return !isCosmeticEdit(entry.before, entry.after)
      return !entry.complete
    }
    const body = entry.body
    if (entry.opaque && dispositionKind(body) === currentKind && currentKind) return true
    if (isLikelyPatchFragment(body, currentBody, dispositionKind)) {
      return compactEditText(body).length > 0
    }
    if (dispositionKind(body) !== currentKind) return true
    if (isCosmeticEdit(body, currentBody)) return false
    return compactEditText(body) !== compactEditText(currentBody)
  })
}

function reviewerDispositionParts(body) {
  return String(body || '')
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+|(?<=[,，])\s*(?=(?:but|however|yet)\b|但|不过|然而)/i)
    .map((part) => part
      .replace(/^(?:(?:but|however|yet)\b|但|不过|然而)\s*/i, '')
      .trim())
    .filter(Boolean)
}

function dispositionScopeParts(body) {
  return String(body || '')
    .split(/(?<=[。！？!?；;])|\n+|(?<=\.)\s+|\s+(?=(?:and|but|however|yet)\b)|(?=(?:同时|但|不过|然而))/i)
    .map((part) => part.trim())
    .filter(Boolean)
}

function hasScopedReviewerRejection(body, rejectionPattern, negatedPattern) {
  return dispositionScopeParts(body).some((part) => (
    rejectionPattern.test(part) && !negatedPattern.test(part)
  ))
}

function reviewerAcceptanceKindForPart(part, hasTrailingNonBlockingLimitation = false) {
  const scopedNonBlocking = REVIEWER_SCOPED_NON_BLOCKING_ACCEPTANCE_PATTERN.test(part)
    && !REVIEWER_SCOPED_NON_BLOCKING_UNCERTAINTY_PATTERN.test(part)
    && !REVIEWER_SCOPED_NON_BLOCKING_TECHNICAL_SUBJECT_PATTERN.test(part)
    && !REVIEWER_SCOPED_NON_BLOCKING_LIMITATION_PATTERN.test(part)
    && !hasTrailingNonBlockingLimitation
  if (!(REVIEWER_ACCEPTANCE_PATTERN.test(part)
    || REVIEWER_WITHDRAWAL_ACCEPTANCE_PATTERN.test(part)
    || REVIEWER_SEPARATE_HANDLING_ACCEPTANCE_PATTERN.test(part)
    || scopedNonBlocking)
    || REVIEWER_ACCEPTANCE_UNCERTAINTY_PATTERN.test(part)
    || isExplicitReviewerRejection(part)) return null
  if (REVIEWER_DEFERRAL_ACCEPTANCE_PATTERN.test(part)
    || REVIEWER_WITHDRAWAL_ACCEPTANCE_PATTERN.test(part)
    || REVIEWER_SEPARATE_HANDLING_ACCEPTANCE_PATTERN.test(part)
    || scopedNonBlocking) return 'deferral'
  if (REVIEWER_FIXED_ACCEPTANCE_PATTERN.test(part)) return 'fixed'
  return 'generic'
}

function latestReviewerTextDisposition(body) {
  let latest = null
  const parts = reviewerDispositionParts(body)
  for (const [index, part] of parts.entries()) {
    if (isExplicitReviewerRejection(part)) {
      latest = { disposition: 'reject', acceptanceKind: null, evidence: part }
      continue
    }
    const hasTrailingNonBlockingLimitation = REVIEWER_SCOPED_NON_BLOCKING_ACCEPTANCE_PATTERN.test(part)
      && REVIEWER_NON_BLOCKING_LIMITATION_FRAGMENT_PATTERN.test(parts[index + 1] || '')
    const acceptanceKind = reviewerAcceptanceKindForPart(part, hasTrailingNonBlockingLimitation)
    if (acceptanceKind && REVIEWER_PROSPECTIVE_ACCEPTANCE_PATTERN.test(part)) {
      latest = { disposition: 'pending', acceptanceKind: null, evidence: part }
      continue
    }
    if (acceptanceKind) latest = { disposition: 'accept', acceptanceKind, evidence: part }
  }
  return latest
}

function reviewerAcceptanceEvidence(body) {
  const latest = latestReviewerTextDisposition(body)
  return latest?.disposition === 'accept' ? latest.evidence : ''
}

function isExplicitReviewerAcceptance(body) {
  return latestReviewerTextDisposition(body)?.disposition === 'accept'
}

function reviewerAcceptanceKind(body) {
  const latest = latestReviewerTextDisposition(body)
  return latest?.disposition === 'accept' ? latest.acceptanceKind : null
}

function isExplicitReviewerRejection(body) {
  const value = String(body || '')
  return REVIEWER_REJECTION_PATTERN.test(value)
    || hasScopedReviewerRejection(
      value,
      REVIEWER_SCOPED_NON_BLOCKING_REJECTION_PATTERN,
      NEGATED_REVIEWER_SCOPED_NON_BLOCKING_REJECTION_PATTERN,
    )
    || NEGATED_REVIEWER_FIXED_CONFIRMATION_PATTERN.test(value)
    || MANDATORY_REVIEWER_NON_ACCEPTANCE_PATTERN.test(value)
    || QUALIFIED_REVIEWER_NON_ACCEPTANCE_PATTERN.test(value)
    || QUALIFIED_REVIEWER_FIXED_NON_CONFIRMATION_PATTERN.test(value)
    || PAST_REVIEWER_NON_ACCEPTANCE_PATTERN.test(value)
    || INDIRECT_REVIEWER_NON_ACCEPTANCE_PATTERN.test(value)
    || REVIEWER_SEPARATE_HANDLING_NON_ACCEPTANCE_PATTERN.test(value)
    || REVIEWER_SEPARATE_HANDLING_SUPPORT_REJECTION_PATTERN.test(value)
    || hasScopedReviewerRejection(
      value,
      REVIEWER_SEPARATE_CONCERN_REJECTION_PATTERN,
      NEGATED_REVIEWER_SEPARATE_CONCERN_REJECTION_PATTERN,
    )
    || NEGATED_REVIEWER_WITHDRAWAL_PATTERN.test(value)
    || REVIEWER_WITHDRAWAL_REFUSAL_PATTERN.test(value)
}

function reviewerDispositionKind(body) {
  return latestReviewerTextDisposition(body)?.disposition || null
}

function reviewerDispositionTime(comment) {
  if (!hasSemanticDispositionEdit(comment, reviewerDispositionKind)) {
    return dispositionTime(comment)
  }
  if (reviewerDispositionKind(comment.body) !== 'accept') return commentTime(comment)
  const currentAcceptance = reviewerAcceptanceKind(comment.body)
  const provesFreshAcceptance = comment?.edits_complete !== false
    && editEntries(comment).some((entry) => {
      if (entry.type === 'empty') return false
      if (entry.type === 'patch') {
        return entry.complete
          && reviewerAcceptanceKind(entry.after) === currentAcceptance
          && reviewerAcceptanceKind(entry.before) !== currentAcceptance
      }
      return reviewerAcceptanceKind(entry.body) !== currentAcceptance
    })
  return provesFreshAcceptance ? commentTime(comment) : dispositionTime(comment)
}

function severityDispositionKind(body) {
  const value = String(body || '')
  return SEVERITY_CHANGE_PATTERN.test(value)
    ? destinationSeverityOf(value)
    : severityOf(value)
}

function severityDispositionTime(comment) {
  const createdAt = dispositionTime(comment)
  const updatedAt = commentTime(comment)
  if (!updatedAt || updatedAt <= createdAt) return createdAt

  const currentSeverity = severityDispositionKind(comment.body)
  const entries = editEntries(comment)
  const severityChanged = entries.some((entry) => {
    if (entry.type === 'empty') return false
    if (entry.type === 'patch') {
      const beforeSeverity = severityDispositionKind(entry.before)
      const afterSeverity = severityDispositionKind(entry.after)
      return beforeSeverity !== afterSeverity && Boolean(beforeSeverity || afterSeverity)
    }
    if (isLikelyPatchFragment(entry.body, comment.body, severityDispositionKind)) return false
    return severityDispositionKind(entry.body) !== currentSeverity
  })
  if (severityChanged) return updatedAt

  // If GitHub did not return a complete edit history, only move a high-risk
  // severity forward. Moving a low-risk P2/P3 forward could hide a later P0/P1.
  const hasOpaqueSeverityEdit = entries.length === 0
    || entries.every((entry) => entry.type === 'empty'
      || (entry.type === 'patch' && !entry.complete))
  if (comment?.edits_complete === false || hasOpaqueSeverityEdit) {
    return isHighSeverity(currentSeverity) ? updatedAt : createdAt
  }
  return createdAt
}

function authorDispositionEvents(comment, index) {
  const currentKind = authorDispositionKind(comment.body)
  const historicalDeferral = editDispositionTexts(comment).some((body) => isProductDeferral(body))
    || hasOpaqueDispositionEdit(comment)
  const semanticEdit = hasSemanticDispositionEdit(comment, authorDispositionKind)
  const at = semanticEdit ? commentTime(comment) : dispositionTime(comment)

  if (currentKind === 'deferral') {
    return [{ kind: 'deferral', index, at, strictAfter: semanticEdit, semanticEdit }]
  }
  if (!historicalDeferral) {
    return currentKind
      ? [{ kind: currentKind, index, at, strictAfter: semanticEdit, semanticEdit }]
      : []
  }

  const deferralAt = currentKind ? dispositionTime(comment) : at
  return [
    {
      kind: 'deferral', index, at: deferralAt,
      strictAfter: !currentKind && semanticEdit,
      semanticEdit: !currentKind && semanticEdit,
    },
    ...(currentKind
      ? [{ kind: currentKind, index, at, strictAfter: semanticEdit, semanticEdit }]
      : []),
  ]
}

function isProductDeferral(body) {
  const value = String(body || '')
    .replace(NEGATED_PRODUCT_DEFERRAL_PATTERN, ' ')
    .replace(NEGATED_FOLLOW_UP_DEFERRAL_PATTERN, ' ')
    .replace(NEGATED_INTENDED_BEHAVIOR_PATTERN, ' ')
  return PRODUCT_DEFERRAL_PATTERN.test(value)
    || PRESENT_PROGRESSIVE_NO_CHANGE_PATTERN.test(value)
    || AUTHOR_PLANNED_NO_CHANGE_PATTERN.test(value)
    || AUTHOR_EXPLICIT_REFUSAL_PATTERN.test(value)
    || AUTHOR_DECISION_NO_FIX_PATTERN.test(value)
    || AUTHOR_INTENTION_NO_FIX_PATTERN.test(value)
    || AUTHOR_INABILITY_NO_FIX_PATTERN.test(value)
    || AUTHOR_POSTPONED_FIX_PATTERN.test(value)
    || INTENDED_BEHAVIOR_DEFERRAL_PATTERN.test(value)
    || (NO_CHANGE_DEFERRAL_PATTERN.test(value)
      && !NON_BEHAVIOR_NO_CHANGE_PATTERN.test(value))
}

function isFindingFixedClaim(body) {
  const value = String(body || '')
  return !NEGATED_FINDING_FIXED_PATTERN.test(value) && FINDING_FIXED_PATTERN.test(value)
}

function isFindingFixRetraction(body) {
  return NEGATED_FINDING_FIXED_PATTERN.test(String(body || ''))
}

function severityOf(body) {
  const match = String(body || '').match(SEVERITY_PATTERN)
  const level = match?.slice(1).find(Boolean)
  return level ? `P${level}` : null
}

function destinationSeverityOf(body) {
  const value = String(body || '')
  const target = value.match(
    /(?:\bshould\s+be\s+P([0123])\b|\b(?:to|into|as)\s+P([0123])\b|\bP[0123]\s*(?:-|=)?\>\s*P([0123])\b|(?:改为|调整为|定为|升级为|降级为|提高到|降低到|变为|至|到)\s*P([0123])\b)/i,
  )
  const targetLevel = target?.slice(1).find(Boolean)
  if (targetLevel) return `P${targetLevel}`

  const levels = [...value.matchAll(new RegExp(SEVERITY_PATTERN.source, 'ig'))]
    .map((match) => match.slice(1).find(Boolean))
    .filter(Boolean)
  const last = levels.at(-1)
  return last ? `P${last}` : null
}

function severityDispositionOf(body, initial = false) {
  const value = String(body || '')
  const severity = initial ? severityOf(value) : destinationSeverityOf(value)
  if (!severity) return null
  if (initial || SEVERITY_CHANGE_PATTERN.test(value)) return severity
  return null
}

function isHighSeverity(severity) {
  return severity === 'P0' || severity === 'P1'
}

export function normalizeProductDecisionIssueComment(comment) {
  return {
    login: comment.user?.login || comment.author?.login || '',
    body: comment.body || '',
    created_at: comment.created_at || comment.createdAt,
    updated_at: comment.updated_at || comment.updatedAt,
    edits: (comment.userContentEdits?.nodes || []).map((edit) => ({
      edited_at: edit.editedAt,
      diff: edit.diff || '',
    })),
    edits_complete: comment.userContentEdits?.pageInfo?.hasNextPage !== true,
  }
}

export function normalizeProductDecisionThread(thread) {
  return {
    is_resolved: thread.isResolved,
    is_outdated: thread.isOutdated,
    resolved_by: thread.resolvedBy?.login || '',
    comments: thread.comments.nodes.map((comment) => ({
      login: comment.author?.login || '',
      body: comment.body || '',
      created_at: comment.createdAt,
      updated_at: comment.updatedAt,
      review_id: comment.pullRequestReview?.databaseId || null,
      edits: (comment.userContentEdits?.nodes || []).map((edit) => ({
        edited_at: edit.editedAt,
        diff: edit.diff || '',
      })),
      edits_complete: comment.userContentEdits?.pageInfo?.hasNextPage !== true,
    })),
  }
}

function latestDisposition(dispositions) {
  const latestAt = Math.max(...dispositions.map((item) => item.at))
  const candidates = dispositions.filter((item) => item.at === latestAt)
  if (candidates.length === 1) return candidates[0].disposition

  // A semantic edit and another event sharing GitHub's second-level timestamp
  // have no provable cross-event order. Preserve explicit non-acceptance.
  if (candidates.some((item) => item.semanticEdit)
    && candidates.some((item) => item.disposition !== 'accept')) {
    return candidates.some((item) => item.disposition === 'reject') ? 'reject' : 'pending'
  }

  const reviewOrders = candidates.map((item) => item.reviewOrder)
  if (reviewOrders.every(Number.isSafeInteger) && reviewOrders.every((order) => order >= 0)) {
    const latestReviewOrder = Math.max(...reviewOrders)
    const latestReview = candidates.filter((item) => item.reviewOrder === latestReviewOrder)
    if (latestReview.length === 1) return latestReview[0].disposition
    if (latestReview.every((item) => item.source === 'thread')) {
      return latestReview.sort((left, right) => left.index - right.index).at(-1).disposition
    }
    if (latestReview.some((item) => item.disposition === 'reject')) return 'reject'
    return latestReview.some((item) => item.disposition === 'pending') ? 'pending' : 'accept'
  }

  if (candidates.every((item) => item.source === candidates[0].source)) {
    return candidates.sort((left, right) => left.index - right.index).at(-1).disposition
  }
  if (candidates.some((item) => item.disposition === 'reject')) return 'reject'
  return candidates.some((item) => item.disposition === 'pending') ? 'pending' : 'accept'
}

function latestAuthorDisposition(events) {
  const latestAt = Math.max(...events.map((event) => event.at))
  const candidates = events.filter((event) => event.at === latestAt)
  if (candidates.length === 1) return candidates[0]

  // GitHub timestamps have second-level precision. If any tied event is a
  // semantic edit, array position cannot prove whether a fixed claim followed
  // the edited deferral. Preserve the non-fix disposition fail-closed.
  if (candidates.some((event) => event.semanticEdit)) {
    const conservative = candidates.filter((event) => event.kind !== 'fixed')
    if (conservative.length > 0) {
      return conservative.sort((left, right) => left.index - right.index).at(-1)
    }
  }
  return candidates.sort((left, right) => left.index - right.index).at(-1)
}

function threadEventFollows({ at, index, semanticEdit = false }, boundaryAt, boundaryIndex, boundaryIsEdit = false) {
  if (at > boundaryAt) return true
  if (at < boundaryAt) return false
  if (semanticEdit || boundaryIsEdit) return false
  return index > boundaryIndex
}

function latestReviewerDisposition({
  thread,
  reviewerLogin,
  afterIndex,
  highFindingAt,
  highFindingIndex,
  highFindingIsEdit,
  evidenceAt,
  evidenceStrictAfter,
  evidenceKind,
  reviews,
  headOid,
}) {
  const evidenceCreatedAt = dispositionTime(thread.comments[afterIndex]) || Number.MAX_SAFE_INTEGER
  const originalBoundary = Math.max(evidenceCreatedAt, highFindingAt || 0)
  const effectiveBoundary = Math.max(evidenceAt || evidenceCreatedAt, highFindingAt || 0)
  const dispositions = []
  const reviewById = new Map(reviews.map((review, index) => [
    String(review.id || ''),
    { review, index },
  ]))
  const threadReviewOrder = (comment, at) => {
    const linked = reviewById.get(String(comment.review_id || ''))
    if (!linked
      || !sameHead(linked.review.commit_id, headOid)
      || eventTime(linked.review.submitted_at) !== at) return undefined
    return linked.index
  }

  for (const [index, comment] of thread.comments.entries()) {
    if (String(comment.login || '').toLowerCase() !== reviewerLogin) continue
    const semanticEdit = hasSemanticDispositionEdit(comment, reviewerDispositionKind)
    const at = reviewerDispositionTime(comment)
    const textDisposition = reviewerDispositionKind(comment.body)
    if (textDisposition && textDisposition !== 'accept') {
      if (at >= originalBoundary) {
        dispositions.push({
          disposition: textDisposition, at,
          source: 'thread',
          reviewOrder: threadReviewOrder(comment, at),
          index,
          semanticEdit,
        })
      }
    } else {
      const acceptanceKind = reviewerAcceptanceKind(comment.body)
      const acceptsCurrentEvidence = acceptanceKind
        && !(acceptanceKind === 'fixed' && evidenceKind !== 'fixed')
      if (acceptsCurrentEvidence
        && threadEventFollows(
          { at, index, semanticEdit },
          evidenceAt || evidenceCreatedAt,
          afterIndex,
          evidenceStrictAfter,
        )
        && threadEventFollows(
          { at, index, semanticEdit },
          highFindingAt || 0,
          highFindingIndex,
          highFindingIsEdit,
        )) {
        dispositions.push({
          disposition: 'accept', at,
          source: 'thread',
          reviewOrder: threadReviewOrder(comment, at),
          index,
          semanticEdit,
        })
      }
    }
  }

  for (const [index, review] of reviews.entries()) {
    if (String(review.login || '').toLowerCase() !== reviewerLogin
      || !sameHead(review.commit_id, headOid)) continue
    const at = eventTime(review.submitted_at)
    const state = String(review.state || '').toUpperCase()
    if (state === 'CHANGES_REQUESTED' && at >= originalBoundary) {
      dispositions.push({
        disposition: 'reject', at,
        source: 'review', reviewOrder: index,
        index,
      })
    } else if (state === 'APPROVED' && at > effectiveBoundary) {
      dispositions.push({
        disposition: 'accept', at,
        source: 'review', reviewOrder: index,
        index,
      })
    }
  }

  if (dispositions.length === 0) return null
  return latestDisposition(dispositions)
}

function ownerDecisionEvidence({ authorLogin, headOid, after, reviews, comments }) {
  const author = String(authorLogin || '').toLowerCase()
  if (isMergeOwner(author)) return `owner-author:${author}`

  const marker = ownerApprovalMarker(headOid)
  const decisions = []

  for (const [index, review] of reviews.entries()) {
    if (!isMergeOwner(review.login) || !sameHead(review.commit_id, headOid)) continue
    const state = String(review.state || '').toUpperCase()
    if (state !== 'APPROVED' && state !== 'CHANGES_REQUESTED') continue
    const at = eventTime(review.submitted_at)
    if (at <= after) continue
    decisions.push({
      disposition: state === 'APPROVED' ? 'accept' : 'reject',
      at,
      source: 'owner-review',
      index,
      evidence: state === 'APPROVED' ? `owner-review:${review.login}` : null,
    })
  }

  for (const [index, comment] of comments.entries()) {
    if (!isMergeOwner(comment.login)) continue
    const kind = ownerCommentDecisionKind(comment.body, marker, headOid)
    if (!kind) continue
    const at = kind === 'accept'
      ? ownerMarkerTime(comment, marker)
      : ownerWithdrawalTime(comment, marker, headOid)
    if (at <= after) continue
    decisions.push({
      disposition: kind,
      at,
      source: 'owner-comment',
      index,
      semanticEdit: at > dispositionTime(comment),
      evidence: kind === 'accept' ? `owner-marker:${comment.login}` : null,
    })
  }

  if (decisions.length === 0 || latestDisposition(decisions) !== 'accept') return null
  const latestAt = Math.max(...decisions.map((decision) => decision.at))
  return decisions
    .filter((decision) => decision.at === latestAt && decision.disposition === 'accept')
    .sort((left, right) => left.index - right.index)
    .at(-1)?.evidence || null
}

function ownerCommentDecisionKind(body, marker, headOid) {
  const value = String(body || '')
  const withdrawalKind = ownerProductDecisionWithdrawalKind(value, headOid)
  if (withdrawalKind) return withdrawalKind
  return value.toLowerCase().includes(marker) ? 'accept' : null
}

function patternMatches(pattern, value) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...String(value || '').matchAll(new RegExp(pattern.source, flags))]
    .map((match) => ({ start: match.index, end: match.index + match[0].length }))
}

function ownerProductDecisionWithdrawalKind(body, headOid) {
  const value = String(body || '')
  const currentHead = String(headOid || '').toLowerCase()
  let latest = null
  for (const part of dispositionScopeParts(value)) {
    const referencedHeads = part.match(/\b[0-9a-f]{7,40}\b/gi) || []
    if (referencedHeads.length > 0
      && !referencedHeads.some((reference) => currentHead.startsWith(reference.toLowerCase()))) {
      continue
    }

    const negatedRanges = patternMatches(NEGATED_OWNER_APPROVAL_WITHDRAWAL_PATTERN, part)
    const pendingRanges = patternMatches(PENDING_OWNER_APPROVAL_WITHDRAWAL_PATTERN, part)
    const withdrawalRanges = [
      ...patternMatches(OWNER_PRODUCT_DECISION_WITHDRAWAL_PATTERN, part),
      ...patternMatches(OWNER_GENERIC_APPROVAL_WITHDRAWAL_PATTERN, part),
      ...patternMatches(OWNER_LATE_APPROVAL_WITHDRAWAL_PATTERN, part),
    ].filter((withdrawal) => ![...negatedRanges, ...pendingRanges].some((range) => (
      withdrawal.start >= range.start && withdrawal.end <= range.end
    )))

    const events = [
      ...pendingRanges.map((range) => ({ ...range, kind: 'pending' })),
      ...withdrawalRanges.map((range) => ({ ...range, kind: 'reject' })),
    ].sort((left, right) => left.end - right.end
      || left.start - right.start
      || (left.kind === 'pending' ? 1 : -1))
    if (events.length > 0) latest = events.at(-1).kind
  }
  return latest
}

function ownerWithdrawalTime(comment, marker, headOid) {
  const createdAt = dispositionTime(comment)
  if (createdAt <= 0) return 0
  const kind = (body) => ownerCommentDecisionKind(body, marker, headOid)
  return hasSemanticDispositionEdit(comment, kind) ? commentTime(comment) : createdAt
}

function ownerMarkerTime(comment, marker) {
  const createdAt = dispositionTime(comment)
  if (createdAt <= 0) return 0
  if (comment?.edits_complete === false) return createdAt

  let previousHasMarker = null
  for (const edit of [...(comment?.edits || [])]
    .sort((left, right) => eventTime(left.edited_at) - eventTime(right.edited_at))) {
    const entry = editEntries({ edits: [edit] })[0]
    if (entry?.type === 'patch') {
      const beforeHasMarker = entry.before.toLowerCase().includes(marker)
      const afterHasMarker = entry.after.toLowerCase().includes(marker)
      if (entry.complete && !beforeHasMarker && afterHasMarker) {
        return eventTime(edit.edited_at) || createdAt
      }
      continue
    }
    if (entry?.type !== 'body' || entry.opaque) continue
    const hasMarker = entry.body.toLowerCase().includes(marker)
    if (previousHasMarker === false && hasMarker) {
      return eventTime(edit.edited_at) || createdAt
    }
    previousHasMarker = hasMarker
  }
  return createdAt
}

export function evaluateProductDecisionGate({
  headOid,
  authorLogin,
  threads = [],
  reviews = [],
  comments = [],
}) {
  const author = String(authorLogin || '').toLowerCase()
  const blockers = []

  for (const thread of threads) {
    if (!thread.is_resolved) continue
    const reviewerComments = thread.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment }) => String(comment.login || '').toLowerCase() !== author)
    const findingOrigin = { comment: thread.comments[0], index: 0 }
    if (!findingOrigin.comment
      || String(findingOrigin.comment.login || '').toLowerCase() === author) continue
    const finding = findingOrigin.comment
    const reviewerLogin = String(finding.login || '').toLowerCase()
    const findingEvents = []
    for (const { comment, index } of reviewerComments) {
      if (String(comment.login || '').toLowerCase() !== reviewerLogin) continue
      const severity = severityDispositionOf(comment.body, findingEvents.length === 0)
      if (!severity) continue
      const at = severityDispositionTime(comment)
      findingEvents.push({
        comment,
        index,
        severity,
        at,
        semanticEdit: at > dispositionTime(comment),
      })
    }
    if (findingEvents.length === 0) continue
    const latestFindingAt = Math.max(...findingEvents.map((event) => event.at))
    const latestFindingCandidates = findingEvents.filter((event) => event.at === latestFindingAt)
    const latestFinding = latestFindingCandidates.sort((left, right) => {
      const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 }
      return severityRank[left.severity] - severityRank[right.severity]
        || right.index - left.index
    })[0]
    if (!latestFinding || !isHighSeverity(latestFinding.severity)) continue

    // Severity follows the latest explicit marker. Preserve author disposition
    // history across both P2 -> P1 escalation and P1 -> P2 downgrade.
    const findingStartIndex = findingOrigin.index
    const severity = latestFinding.severity
    const highFindingAt = latestFinding.at
    const authorEvents = thread.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment, index }) => (
        index > findingStartIndex
          && String(comment.login || '').toLowerCase() === author
      ))
      .flatMap(({ comment, index }) => authorDispositionEvents(comment, index))
      .sort((left, right) => left.at - right.at || left.index - right.index)

    const latestDeferral = authorEvents.filter((event) => event.kind === 'deferral').at(-1)
    if (!latestDeferral) continue
    const deferralIndex = latestDeferral.index
    const evidenceEvent = latestAuthorDisposition(authorEvents)
    const reviewerDisposition = latestReviewerDisposition({
      thread,
      reviewerLogin,
      afterIndex: evidenceEvent.index,
      highFindingAt,
      highFindingIndex: latestFinding.index,
      highFindingIsEdit: latestFinding.semanticEdit,
      evidenceAt: evidenceEvent.at,
      evidenceStrictAfter: evidenceEvent.strictAfter,
      evidenceKind: evidenceEvent.kind,
      reviews,
      headOid,
    })
    if (reviewerDisposition === 'accept') continue
    blockers.push({
      severity,
      reviewer: finding.login || 'unknown',
      at: Math.max(
        evidenceEvent.at || commentTime(thread.comments[deferralIndex]) || Number.MAX_SAFE_INTEGER,
        highFindingAt,
      ),
    })
  }

  if (blockers.length === 0) {
    return { satisfied: true, reason: null, evidence: null, blockers: [] }
  }

  const evidence = ownerDecisionEvidence({
    authorLogin,
    headOid,
    after: Math.max(...blockers.map((item) => item.at)),
    reviews,
    comments,
  })
  if (evidence) return { satisfied: true, reason: null, evidence, blockers: [] }

  const detail = blockers.map((item) => `${item.severity}:${item.reviewer}`).join(', ')
  return {
    satisfied: false,
    reason: `P0/P1 finding 被作者以产品取舍关闭，待 Chris 或 Bobo 确认当前 head（${detail}）`,
    evidence: null,
    needsOwnerReview: true,
    blockers,
  }
}
