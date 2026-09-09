// Built-in demo problem so the app is usable (and testable) without an API key.
// All cases are literal — the prompt no longer asks for "generated"/stress inputs.
export function exampleContract() {
  return {
    problem: {
      title: "Two Sum",
      difficulty: "easy",
      topics: ["array", "hash-map"],
      normalized_statement:
        "Given an array of integers `nums` and an integer `target`, return the indices of the two numbers such that they add up to `target`.\n\nYou may assume that each input has exactly one solution, and you may not use the same element twice.",
    },
    function_signature: {
      name: "two_sum",
      kind: "function",
      parameters: [
        { name: "nums", type: "List[int]" },
        { name: "target", type: "int" },
      ],
      return_type: "List[int]",
    },
    constraints: {
      raw: "2 <= nums.length <= 10^4, -10^9 <= nums[i] <= 10^9",
      input_bounds: {
        nums: { length_min: 2, length_max: 10000, value_min: -1000000000, value_max: 1000000000 },
        target: { value_min: -2000000000, value_max: 2000000000 },
      },
    },
    reference_solution: {
      language: "python",
      code:
        "def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n    return []",
      expected_time_complexity: "O(n)",
      expected_space_complexity: "O(n)",
    },
    test_cases: [
      {
        id: "example_1",
        category: "example",
        description: "given example from the problem statement",
        input_mode: "literal",
        input: { nums: [2, 7, 11, 15], target: 9 },
      },
      {
        id: "example_2",
        category: "example",
        description: "answer is not the first pair",
        input_mode: "literal",
        input: { nums: [3, 2, 4], target: 6 },
      },
      {
        id: "example_3",
        category: "example",
        description: "smallest possible input",
        input_mode: "literal",
        input: { nums: [3, 3], target: 6 },
      },
      {
        id: "edge_negatives",
        category: "edge",
        description: "negative values summing to a negative target",
        input_mode: "literal",
        input: { nums: [-3, 4, 3, 90], target: 0 },
      },
      {
        id: "edge_duplicates",
        category: "edge",
        description: "duplicate values, correct pair must use distinct indices",
        input_mode: "literal",
        input: { nums: [3, 3, 4, 4], target: 8 },
      },
      {
        id: "edge_large_values",
        category: "edge",
        description: "values at the boundary of the allowed range",
        input_mode: "literal",
        input: { nums: [1000000000, -1000000000, 5], target: 0 },
      },
    ],
    generation_meta: { provider: "example", model: "none", prompt_version: "v1", warnings: [] },
  };
}
