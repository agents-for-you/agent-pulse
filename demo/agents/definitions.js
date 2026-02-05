/**
 * Agent personality definitions for demos
 * Each agent has a role, communication style, and behavior patterns
 */

/**
 * Agent: Alice - The Coordinator
 * Role: Task delegation and orchestration
 */
export const alice = {
  name: 'Alice',
  role: 'Coordinator',
  color: 'blue',
  pubkey: 'e42bbb25650c0ef601bb0f5adb099bbf4570ff00ad8ace4166b1ae45508d1534',
  systemPrompt: `You are Alice, a coordinator agent. You:
- Delegate tasks to worker agents
- Aggregate and validate results
- Monitor task completion
- Provide status updates`,

  // Response patterns and handlers
  handlers: {
    greeting: /^hello|hi|hey/i,
    task: /^task:|compute:|process:/i,
    status: /^status|report/i,
    help: /^help|\?/i
  },

  responses: {
    greeting: ['Hello! Ready to coordinate tasks.', 'Hi! I have tasks to delegate.'],
    taskReceived: ['Task received. Delegating...', 'Processing task request...'],
    completed: ['All tasks completed!', 'Coordination cycle complete.']
  }
}

/**
 * Agent: Bob - The Worker
 * Role: Numerical computation and data processing
 */
export const bob = {
  name: 'Bob',
  role: 'Data Processor',
  color: 'green',
  pubkey: 'd1a4b789d45c3d29f6012d765b3532d5789e4c9575d96a9e0c2d1b9f0a1c2d3e',
  systemPrompt: `You are Bob, a data processing agent. You:
- Process numerical data efficiently
- Perform calculations and aggregations
- Return structured results
- Acknowledge task completion`,

  handlers: {
    compute: /^compute|calculate|math/i,
    aggregate: /^aggregate|sum|average/i,
    filter: /^filter|extract/i
  },

  responses: {
    compute: ['Computing...', 'Calculating...'],
    done: ['Calculation complete.', 'Results ready.']
  }
}

/**
 * Agent: Charlie - The Analyst
 * Role: Text analysis and insight generation
 */
export const charlie = {
  name: 'Charlie',
  role: 'Analyst',
  color: 'magenta',
  pubkey: 'f2a6b123e67d8e31a8346c2f12389034ab9c8d34567890cdef1234567890abcdef',
  systemPrompt: `You are Charlie, an analyst agent. You:
- Analyze text and patterns
- Extract insights from data
- Provide summaries and reports
- Flag anomalies`,

  handlers: {
    analyze: /^analyze|review|inspect/i,
    summarize: /^summarize|brief/i,
    insights: /^insights|findings/i
  },

  responses: {
    analyzing: ['Analyzing...', 'Processing data...'],
    done: ['Analysis complete.', 'Insights generated.']
  }
}

/**
 * Agent: Diana - The Validator
 * Role: Quality assurance and validation
 */
export const diana = {
  name: 'Diana',
  role: 'Validator',
  color: 'cyan',
  pubkey: 'a3b8c321f89e0f42b9457d30123456789bcde01234567890fab12345678901234',
  systemPrompt: `You are Diana, a validator agent. You:
- Validate results from other agents
- Check for consistency and errors
- Ensure quality standards
- Report issues`,

  handlers: {
    validate: /^validate|verify|check/i,
    compare: /^compare|diff/i
  },

  responses: {
    validating: ['Validating...', 'Checking...'],
    passed: ['Validation passed.', 'All checks passed.'],
    failed: ['Validation failed.', 'Issues found.']
  }
}

/**
 * Agent: Eve - The Explorer
 * Role: Discovery and new task suggestion
 */
export const eve = {
  name: 'Eve',
  role: 'Explorer',
  color: 'yellow',
  pubkey: 'b4c9d43209f1a53c0568e41234567890def1234567890abc12345678901234567',
  systemPrompt: `You are Eve, an explorer agent. You:
- Discover new opportunities
- Suggest optimizations
- Find patterns in workflows
- Propose new tasks`,

  handlers: {
    explore: /^explore|discover|find/i,
    suggest: /^suggest|recommend|advise/i
  },

  responses: {
    exploring: ['Exploring...', 'Searching...'],
    found: ['Found something!', 'Discovery complete.']
  }
}

/**
 * Agent registry for easy lookup
 */
export const agents = {
  alice,
  bob,
  charlie,
  diana,
  eve
}

/**
 * Get agent by pubkey
 */
export function getByPubkey(pubkey) {
  for (const agent of Object.values(agents)) {
    if (agent.pubkey === pubkey) {
      return agent
    }
  }
  return null
}

/**
 * Get agent by name
 */
export function getByName(name) {
  return agents[name.toLowerCase()]
}

/**
 * Get all agents as array
 */
export function getAllAgents() {
  return Object.values(agents)
}

/**
 * Get agent by role
 */
export function getByRole(role) {
  for (const agent of Object.values(agents)) {
    if (agent.role.toLowerCase() === role.toLowerCase()) {
      return agent
    }
  }
  return null
}
