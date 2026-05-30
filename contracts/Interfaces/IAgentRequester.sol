//The oracle contract imports an interface that defines the shapes of agent requests and responses 
// (Request, Response, ResponseStatus, and the handler your contract must implement).

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

enum ConsensusType { Majority, Threshold }
enum ResponseStatus {
    None,       // 0 - Default zero value (uninitialized storage)
    Pending,    // 1 - Awaiting responses
    Success,    // 2 - Consensus reached normally
    Failed,     // 3 - Validators reported failure
    TimedOut    // 4 - Request timed out
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}


struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}

interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function getRequestDeposit() external view returns (uint256);
}

// Agent interface (for .selector and type safety)
interface IAgent {
    function fetchString(string memory url, string memory selector) external returns (string memory);
}

contract MyContract {
    IAgentRequester public platform =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    uint256 constant AGENT_ID = 13174292974160097713;
    uint256 constant SUBCOMMITTEE_SIZE = 3; // matches the platform default
    uint256 constant PER_AGENT_EXECUTION_COST = 30000000000000000;

    // Store pending requests
    mapping(uint256 => address) public requestSenders;

    event AgentResponseReceived(uint256 indexed requestId, ResponseStatus status, string result);

    function invokeFetchString(string calldata url, string calldata selector) external payable returns (uint256 requestId) {
        // 1. Encode the function call using the agent interface selector
        bytes memory payload = abi.encodeWithSelector(IAgent.fetchString.selector, url, selector);

        // 2. Safe deposit: contract floor + per-agent execution reward.
        //    Floor only would satisfy the contract but runners would skip
        //    the request because perAgentBudget < scheduledExecutionCost.
        uint256 reserve = platform.getRequestDeposit();
        uint256 reward = PER_AGENT_EXECUTION_COST * SUBCOMMITTEE_SIZE;
        uint256 deposit = reserve + reward;

        // 3. Send request with callback to this contract
        requestId = platform.createRequest{value: deposit}(
            AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );
        requestSenders[requestId] = msg.sender;
    }

    // Called by the platform when consensus is reached
    // Signature matches IAgentRequesterHandler.handleResponse
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external {
        require(msg.sender == address(platform), "Only platform can call");

        if (status == ResponseStatus.Success && responses.length > 0) {
            // Decode the first successful response
            string memory result = abi.decode(responses[0].result, (string));
            emit AgentResponseReceived(requestId, status, result);
        } else {
            // Failed or timed out
            emit AgentResponseReceived(requestId, status, "");
        }
    }

    // Allow receiving rebates
    receive() external payable {}
}