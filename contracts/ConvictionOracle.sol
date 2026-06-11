// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Standalone test harness for the LLM Inference agent's inferNumber function.
// Proves the conviction call returns a clean int 0-100 BEFORE wiring it into the vault
// (same role NewsOracle plays for the Parse Website agent).

import {
    IAgentRequester,
    IAgentRequesterHandler,
    Response,
    Request,
    ResponseStatus
} from "./Interfaces/IAgentRequester.sol";

interface ILlmAgentNumber {
    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256);
}

contract ConvictionOracle is IAgentRequesterHandler {
    IAgentRequester public immutable platform;
    uint256 public constant LLM_AGENT_ID = 12847293847561029384;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant LLM_PRICE_PER_AGENT = 0.07 ether;

    int256 public lastConviction;
    uint8 public lastStatus; // 0=none, 1=success, 2=failed, 3=timedout
    mapping(uint256 => bool) public pendingRequests;

    event ConvictionReceived(uint256 indexed requestId, int256 conviction);
    event RequestFailed(uint256 indexed requestId, uint8 status);

    constructor(address platform_) {
        platform = IAgentRequester(platform_);
    }

    // prompt is a parameter so you can iterate WITHOUT redeploying.
    function requestConviction(string calldata prompt) external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            ILlmAgentNumber.inferNumber.selector,
            prompt,
            "Output only an integer 0-100. No words.",
            int256(0),
            int256(100),
            false
        );

        uint256 dep = platform.getRequestDeposit() + LLM_PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= dep, "UNDERFUNDED");

        requestId = platform.createRequest{value: dep}(
            LLM_AGENT_ID, address(this), this.handleResponse.selector, payload
        );
        pendingRequests[requestId] = true;
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external override {
        require(msg.sender == address(platform), "ONLY_PLATFORM");
        require(pendingRequests[requestId], "UNKNOWN_REQUEST");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            lastConviction = abi.decode(responses[0].result, (int256));
            lastStatus = 1;
            emit ConvictionReceived(requestId, lastConviction);
        } else {
            lastStatus = status == ResponseStatus.Failed ? 2 : 3;
            emit RequestFailed(requestId, lastStatus);
        }
    }

    receive() external payable {}
}
